import pandas as pd
import joblib
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.impute import SimpleImputer
import xgboost as xgb
import sys
import json

# =========================
# 1. ĐỊNH NGHĨA LẠI CLASS (BẮT BUỘC)
# =========================
# Vì lúc train bạn pickle class này,
# nên khi load phải có lại y chang class

class SafeLabelEncoder(BaseEstimator, TransformerMixin):
    def fit(self, y):
        unique = sorted(pd.Series(y).dropna().astype(str).unique())
        self.mapping = {v: i for i, v in enumerate(unique)}
        self.unknown = len(self.mapping)
        return self

    def transform(self, y):
        return pd.Series(y).astype(str).map(self.mapping).fillna(self.unknown).astype(int).values


class PreprocessPipeline:
    def __init__(self, num_cols, cat_cols):
        self.num_cols = num_cols
        self.cat_cols = cat_cols
        self.num_imputer = SimpleImputer(strategy="median")
        self.cat_imputer = SimpleImputer(strategy="constant", fill_value="UNKNOWN")
        self.encoders = {c: SafeLabelEncoder() for c in cat_cols}

    def _time_features(self, df):
        df = df.copy()

        if "FL_DATE" in df.columns:
            df["FL_DATE"] = pd.to_datetime(df["FL_DATE"], errors="coerce")
            df["MONTH"] = df["FL_DATE"].dt.month
            df["DAY"] = df["FL_DATE"].dt.day
            df["DOW"] = df["FL_DATE"].dt.dayofweek

        time_col = None
        for col in ["Scheduled_DEP", "CRS_DEP_TIME", "DEP_TIME"]:
            if col in df.columns:
                time_col = col
                break

        if time_col:
            temp_dt = pd.to_datetime(df[time_col], errors="coerce")
            df["DEP_HOUR"] = temp_dt.dt.hour.fillna(12).astype(int)
        else:
            df["DEP_HOUR"] = 12

        return df

    def fit(self, df):
        df = self._time_features(df)
        self.all_num = self.num_cols + ["MONTH", "DAY", "DOW", "DEP_HOUR"]
        self.num_imputer.fit(df[self.all_num])
        self.cat_imputer.fit(df[self.cat_cols])

        df_cat = pd.DataFrame(
            self.cat_imputer.transform(df[self.cat_cols]),
            columns=self.cat_cols
        )

        for c in self.cat_cols:
            self.encoders[c].fit(df_cat[c])

        return self

    def transform(self, df):
        df = self._time_features(df)

        X_num = pd.DataFrame(
            self.num_imputer.transform(df[self.all_num]),
            columns=self.all_num
        )

        df_cat = pd.DataFrame(
            self.cat_imputer.transform(df[self.cat_cols]),
            columns=self.cat_cols
        )

        for c in self.cat_cols:
            X_num[f"{c}_ENC"] = self.encoders[c].transform(df_cat[c])

        return X_num


# =========================
# 2. LOAD PIPELINE & MODEL
# =========================

import os

# when running from compiled bytecode __file__ may point into __pycache__
# so climb out of it to reach the normal module directory
base = os.path.dirname(__file__)
if base.endswith(os.path.join('__pycache__')):
    base = os.path.dirname(base)
BASE_DIR = base
# pickles are stored inside a subdirectory modelData
PIPE_PATH = os.path.join(BASE_DIR, "modelData", "preprocess_pipeline.pkl")
MODEL_PATH = os.path.join(BASE_DIR, "modelData", "flight_delay_model.pkl")

# load and handle missing file gracefully
try:
    pipe = joblib.load(PIPE_PATH)
except Exception as e:
    sys.stderr.write(f"Failed to load pipeline from {PIPE_PATH}: {e}\n")
    sys.exit(1)

try:
    model = joblib.load(MODEL_PATH)
except Exception as e:
    sys.stderr.write(f"Failed to load model from {MODEL_PATH}: {e}\n")
    sys.exit(1)

# =========================
# 3. PREDICT FROM INPUT
# =========================

if __name__ == "__main__":
    if len(sys.argv) > 1:
        try:
            input_data = json.loads(sys.argv[1])
            df_test = pd.DataFrame([input_data])
            X = pipe.transform(df_test)
            pred = model.predict(X)[0]
            print(pred)
        except Exception as e:
            # send error to stderr so Node can see it
            sys.stderr.write(f"Prediction error: {e}\n")
            sys.exit(1)
    else:
        sys.stderr.write("No input data provided\n")
        sys.exit(1)