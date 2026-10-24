# NutriScan: child malnutrition prediction system

NutriScan now includes a Netlify-compatible website and serverless API. Netlify publishes `public/`, routes direct page visits to the application, and serves authenticated requests through `netlify/functions/api.mts`. Python source files and the SQLite database are outside the published directory.

## Accounts and records

Accounts use Netlify Identity email and password login, with email confirmation, invitations, and password recovery. Identity has been enabled for this project. Create a new account and confirm the email before signing in.

To establish the first administrator, open **Identity** in the Netlify dashboard, invite your administrator, and add the `admin` role in that user's details after they accept. Administrators can see all new assessments, export records, and manage other accounts. Regular users can access only their own assessments. Account disabling is enforced by the API.

New records persist in Netlify Database. The schema is defined in `db/schema.ts`, with generated migrations in `netlify/database/migrations/`. Netlify applies those migrations during deployment. Existing Flask accounts and historical records have not been automatically imported: they remain in the original `nutriscan.db`. A historical import requires mapping each old account to its new Identity user ID; the original database is not served by the website.

## Model

The deployed API uses the fitted logistic regression pipeline from `model.joblib`, exported into `lib/model.json`. Inference retains feature order, standard scaling, recalculated BMI, softmax probabilities, and the original MUAC override. The export was checked against Python predictions on 200 deterministic measurement sets. Recommendations and clinical flags retain the original application behavior.

The Python workflow remains available for offline training. With the Python dependencies installed, train using `python train.py path/to/training.csv`, then run `npm run export-model`, verify with `npm test`, and redeploy. The exporter currently supports the original multiclass logistic regression pipeline; it deliberately fails if a different estimator wins training, rather than silently changing prediction behavior. Browser-based retraining is unavailable in the Netlify version.

## Development and validation

Install Node dependencies with `npm install`. Run `netlify dev --port 8889` to serve the site with function and Identity support. Run `npm run check` for TypeScript checks and `npm test` for model parity and measurement validation tests. Production publishing requires no frontend build command.

Supported pages include `/`, `/login`, `/register`, `/recover`, `/assess`, `/bulk`, `/records`, and `/admin`. CSV uploads support quoted fields and up to 500 rows / 1 MB per upload. Each upload is validated before any records are inserted. Downloads escape spreadsheet formula prefixes.

This is a decision-support tool, not a replacement for clinical assessment. Follow national treatment guidelines.
