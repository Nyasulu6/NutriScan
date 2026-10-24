import sys, joblib, pandas as pd
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report, confusion_matrix
RAW = ['age_months', 'weight_kg', 'height_cm', 'muac_cm']
FEATS = RAW + ['bmi']

def prep(df):
    df = df.copy()
    df['bmi'] = df.weight_kg / (df.height_cm / 100) ** 2  # recomputed: the CSV's bmi column is clipped to 10
    return df

def train(path='data/malnutrition.csv', out='model.joblib'):
    df = pd.read_csv(path).dropna(subset=RAW + ['nutrition_status'])
    df = prep(df)
    X, y = df[FEATS], df['nutrition_status'].str.lower()
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=42)
    cands = {
        'Logistic Regression': make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, class_weight='balanced')),
        'Random Forest': RandomForestClassifier(300, class_weight='balanced', min_samples_leaf=3, random_state=42),
        'Gradient Boosting': GradientBoostingClassifier(random_state=42)}
    cv = {n: cross_val_score(m, Xtr, ytr, cv=5, scoring='f1_macro').mean() for n, m in cands.items()}
    best = max(cv, key=cv.get); model = cands[best].fit(Xtr, ytr)
    pred = model.predict(Xte)
    rep = classification_report(yte, pred, output_dict=True)
    info = {'best': best, 'cv_f1_macro': cv, 'test_accuracy': rep['accuracy'], 'test_f1_macro': rep['macro avg']['f1-score'],
            'report': {k: v for k, v in rep.items() if k in ('normal', 'moderate', 'severe')},
            'confusion': confusion_matrix(yte, pred, labels=['normal', 'moderate', 'severe']).tolist(), 'n_rows': len(df)}
    joblib.dump({'model': model, 'info': info}, out)
    return info

if __name__ == '__main__':
    i = train(*(sys.argv[1:2] or []))
    print(i['best'], i['cv_f1_macro'], 'acc', round(i['test_accuracy'], 3), 'f1', round(i['test_f1_macro'], 3)); print(i['confusion'])
