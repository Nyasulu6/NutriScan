# NutriScan: child malnutrition prediction system
    pip install -r requirements.txt
    python train.py          # optional: model.joblib is included
    python app.py            # http://localhost:5000
Default admin: admin / admin123 (set ADMIN_USER, ADMIN_PASS, SECRET_KEY env vars before first run and in production).
Roles: user (assess, bulk upload, own records) and admin (all records, export, user management, retrain).
Note: the CSV's `bmi` column was clipped to 10, so BMI is recomputed from weight and height.
