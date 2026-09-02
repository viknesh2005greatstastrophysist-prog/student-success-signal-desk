import { randomUUID } from "node:crypto";
import type { ActorContext } from "@aura/contracts";
import { z } from "zod";

import { assertCommandId, findDuplicateCommand, getCurrentGeneration, writeCommandLedger } from "./command-ledger";
import { withCoreTransaction } from "./db";
import { ConflictError, NotFoundError } from "./http";
import { requireRole } from "./security";

export const paymentAttemptInput = z.object({
  expectedRevision: z.number().int().nonnegative(),
  scenario: z.enum(["success", "decline"]),
});

type PaymentTransactionResult = {
  id: string;
  provider: "sandbox";
  providerReference: string;
  amountPaise: number;
  status: "captured" | "failed";
  receiptId: string | null;
};

type PaymentInvoiceResult = {
  id: string;
  invoiceNumber: string;
  status: string;
  amountPaise: number;
  paidPaise: number;
  revision: number;
};

type PaymentAttemptResult = {
  transaction: PaymentTransactionResult;
  invoice: PaymentInvoiceResult;
  duplicate: boolean;
  receipt: Awaited<ReturnType<typeof writeCommandLedger>>;
};

export async function createPaymentAttempt(
  actor: ActorContext,
  invoiceId: string,
  commandId: string,
  input: z.infer<typeof paymentAttemptInput>,
): Promise<PaymentAttemptResult> {
  assertCommandId(commandId);
  z.string().uuid().parse(invoiceId);
  requireRole(actor, "parent");

  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const duplicate = await findDuplicateCommand(client, generationId, commandId, actor.personId);
    if (duplicate) return {
      transaction: duplicate.payload.transaction as PaymentTransactionResult,
      invoice: duplicate.payload.invoice as PaymentInvoiceResult,
      duplicate: true,
      receipt: duplicate.receipt,
    };

    const result = await client.query<{
      id: string;
      student_id: string;
      invoice_number: string;
      description: string;
      amount_paise: string;
      paid_paise: string;
      status: string;
      revision: number;
      due_on: string;
      department_id: string;
    }>(
      `SELECT invoice.id, invoice.student_id, invoice.invoice_number, invoice.description,
              invoice.amount_paise::text, invoice.paid_paise::text, invoice.status, invoice.revision,
              invoice.due_on::text, student.department_id
       FROM fee_invoices invoice
       JOIN student_profiles student ON student.id = invoice.student_id AND student.generation_id = invoice.generation_id
       JOIN parent_links link ON link.generation_id = invoice.generation_id AND link.student_id = invoice.student_id
         AND link.parent_person_id = $3 AND link.active
       JOIN parent_field_grants grant_row ON grant_row.generation_id = link.generation_id
         AND grant_row.parent_link_id = link.id AND grant_row.field_group = 'fees' AND grant_row.granted
       WHERE invoice.generation_id = $1 AND invoice.id = $2
       FOR UPDATE OF invoice`,
      [generationId, invoiceId, actor.personId],
    );
    if (!result.rowCount) throw new NotFoundError("Invoice not found");
    const invoice = result.rows[0]!;
    if (invoice.revision !== input.expectedRevision) throw new ConflictError("STALE_VERSION", "The invoice changed after this page loaded");
    const remainingPaise = Number(invoice.amount_paise) - Number(invoice.paid_paise);
    if (remainingPaise <= 0 || invoice.status === "paid" || invoice.status === "void") {
      throw new ConflictError("INVOICE_NOT_PAYABLE", "This invoice has no payable balance");
    }

    const transactionId = randomUUID();
    const status = input.scenario === "success" ? "captured" : "failed";
    const providerReference = `AURA-SBX-${commandId}`;
    await client.query(
      `INSERT INTO payment_transactions
       (id, generation_id, invoice_id, amount_paise, provider, provider_reference, status, paid_by_person_id)
       VALUES ($1, $2, $3, $4, 'sandbox', $5, $6, $7)`,
      [transactionId, generationId, invoice.id, remainingPaise, providerReference, status, actor.personId],
    );

    let updatedInvoice: PaymentInvoiceResult = {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      status: invoice.status,
      amountPaise: Number(invoice.amount_paise),
      paidPaise: Number(invoice.paid_paise),
      revision: invoice.revision,
    };
    if (status === "captured") {
      const updated = await client.query<{ paid_paise: string; status: string; revision: number }>(
        `UPDATE fee_invoices SET paid_paise = amount_paise, status = 'paid', revision = revision + 1
         WHERE id = $1 RETURNING paid_paise::text, status, revision`,
        [invoice.id],
      );
      updatedInvoice = {
        ...updatedInvoice,
        paidPaise: Number(updated.rows[0]!.paid_paise),
        status: updated.rows[0]!.status,
        revision: updated.rows[0]!.revision,
      };
    }

    const transaction: PaymentTransactionResult = {
      id: transactionId,
      provider: "sandbox",
      providerReference,
      amountPaise: remainingPaise,
      status,
      receiptId: status === "captured" ? transactionId : null,
    };
    const payload = {
      studentId: invoice.student_id,
      departmentId: invoice.department_id,
      parentPersonId: actor.personId,
      transaction,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        status: updatedInvoice.status,
        amountPaise: updatedInvoice.amountPaise,
        paidPaise: updatedInvoice.paidPaise,
        revision: updatedInvoice.revision,
      },
    };
    const receipt = await writeCommandLedger(client, {
      generationId,
      commandId,
      actorPersonId: actor.personId,
      aggregateType: "payment_transaction",
      aggregateId: transactionId,
      eventType: status === "captured" ? "payment.captured" : "payment.failed",
      action: "create_sandbox_payment_attempt",
      topic: status === "captured" ? "finance.payment.captured" : "finance.payment.failed",
      payload,
      metadata: { scenario: input.scenario, provider: "sandbox", invoiceRevision: input.expectedRevision },
    });
    return { transaction, invoice: payload.invoice, duplicate: false, receipt };
  });
}

export async function loadPaymentReceipt(actor: ActorContext, transactionId: string) {
  z.string().uuid().parse(transactionId);
  requireRole(actor, "parent");
  return withCoreTransaction(async (client) => {
    const generationId = await getCurrentGeneration(client);
    const result = await client.query<{
      id: string;
      provider_reference: string;
      amount_paise: string;
      created_at: Date;
      invoice_number: string;
      description: string;
      display_name: string;
      register_number: string;
      term_name: string;
    }>(
      `SELECT transaction.id, transaction.provider_reference, transaction.amount_paise::text, transaction.created_at,
              invoice.invoice_number, invoice.description, person.display_name, student.register_number, term.name AS term_name
       FROM payment_transactions transaction
       JOIN fee_invoices invoice ON invoice.id = transaction.invoice_id AND invoice.generation_id = transaction.generation_id
       JOIN terms term ON term.id = invoice.term_id
       JOIN student_profiles student ON student.id = invoice.student_id
       JOIN people person ON person.id = student.person_id
       JOIN parent_links link ON link.generation_id = transaction.generation_id AND link.student_id = invoice.student_id
         AND link.parent_person_id = $3 AND link.active
       JOIN parent_field_grants grant_row ON grant_row.generation_id = link.generation_id
         AND grant_row.parent_link_id = link.id AND grant_row.field_group = 'fees' AND grant_row.granted
       WHERE transaction.generation_id = $1 AND transaction.id = $2 AND transaction.status = 'captured'`,
      [generationId, transactionId, actor.personId],
    );
    if (!result.rowCount) throw new NotFoundError("Receipt not found");
    const row = result.rows[0]!;
    return {
      receiptId: row.id,
      providerReference: row.provider_reference,
      invoiceNumber: row.invoice_number,
      description: row.description,
      amountPaise: Number(row.amount_paise),
      paidAt: row.created_at.toISOString(),
      studentName: row.display_name,
      registerNumber: row.register_number,
      term: row.term_name,
      mode: "AURA sandbox payment",
    };
  });
}
