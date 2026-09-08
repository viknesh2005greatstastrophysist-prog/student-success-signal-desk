# Chapter 11 submission guide

AURA Student Success and Early Warning combines four evidence sources, applies a mentor-approved risk policy, produces a validated support draft, and publishes it only after the assigned mentor approves. The student, parent, faculty, department and governance portals share PostgreSQL state.

## Live demonstration

- Faculty: https://aura-faculty-portal.vercel.app
- Governance: https://aura-ai-governance.vercel.app
- Student: https://aura-student-portal.vercel.app
- Parent: https://aura-parent-portal.vercel.app
- Department: https://aura-hod-portal.vercel.app

Demo entry requires no PIN or password as of 8 September 2026. Anyone with the portal links can enter the synthetic demo roles. The hosted workflow uses the labelled deterministic mode. For the actual language-model demonstration, use the configured local installation and follow `DEMO_SCRIPT.md`. The local model execution is recorded separately from cloud execution.

This Chapter 11 guide and `../docs/RELEASE_EVIDENCE.md` are the current handoff. Older prototype reports elsewhere in the source archive are historical evidence, not the current release status.

## Start here

1. Read `PROJECT_REPORT.md` for the design and the distinction between implemented software and institutional approval.
2. Run `Chapter11_Lab_Demonstration.ipynb` or `cd platform && npm run chapter11:build` for a reproducible, credential-free lab artifact.
3. Use `DEMO_SCRIPT.md` to demonstrate the connected portals.
4. Review `../docs/CHAPTER11_COMPLETION.md` and `../platform/artifacts/chapter11/` for acceptance evidence.
5. Use `LOCAL_SETUP.md` for a separate local installation and `VIVA_GUIDE.md` to prepare your explanation.
6. See `../docs/DEPLOYMENT.md` for the seven-service deployment procedure and private environment setup.

## Important submission boundary

The professor's Chapter 11 sections 11.2 and Lab 14 explicitly require a real case. All included cases are synthetic. A working software demonstration does not establish that a real mentor approved the methodology or that institutional data access is authorized. Obtain a real mentor's acceptance of this synthetic demonstration, or conduct an authorized real-case pilot, before describing the academic capstone as fully signed off.

No credentials, access PIN, session traces or real student records belong in this submission folder. The full source repository is part of the project; the notebook calls its TypeScript implementation rather than maintaining a separate imitation.
