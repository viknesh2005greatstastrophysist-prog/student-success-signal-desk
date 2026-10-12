-- A simulation may update only generated fees in the hosted college project.
ALTER TABLE fee_invoices
  ADD COLUMN IF NOT EXISTS record_origin text NOT NULL DEFAULT 'unverified';
