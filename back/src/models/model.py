import pandas as pd
import joblib
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.impute import SimpleImputer
from category_encoders import TargetEncoder
import xgboost as xgb
import numpy as np
import sys
import json
import warnings

# =========================
# 1. ĐỊNH NGHĨA LẠI CLASS (BẮT BUỘC)
# =========================
# Vì lúc train bạn pickle class này,
# nên khi load phải có lại y chang class

class PreprocessPipeline:
    def __init__(self, num_cols, cat_cols):
        self.num_cols = num_cols
        self.cat_cols = cat_cols
        self.num_imputer = SimpleImputer(strategy="median")
        self.target_encoder = TargetEncoder(cols=self.cat_cols, handle_unknown="value")

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

        # Cyclical encoding (match training)
        df["MONTH_sin"] = np.sin(2 * np.pi * df["MONTH"] / 12)
        df["MONTH_cos"] = np.cos(2 * np.pi * df["MONTH"] / 12)
        df["DAY_sin"] = np.sin(2 * np.pi * df["DAY"] / 31)
        df["DAY_cos"] = np.cos(2 * np.pi * df["DAY"] / 31)
        df["DOW_sin"] = np.sin(2 * np.pi * df["DOW"] / 7)
        df["DOW_cos"] = np.cos(2 * np.pi * df["DOW"] / 7)
        df["HOUR_sin"] = np.sin(2 * np.pi * df["DEP_HOUR"] / 24)
        df["HOUR_cos"] = np.cos(2 * np.pi * df["DEP_HOUR"] / 24)

        return df

    def fit(self, df, y=None):
        df = self._time_features(df)
        self.time_cols = ["MONTH_sin", "MONTH_cos", "DAY_sin", "DAY_cos", "DOW_sin", "DOW_cos", "HOUR_sin", "HOUR_cos"]
        self.all_num = [c for c in self.num_cols + self.time_cols if c in df.columns]
        self.num_imputer.fit(df[self.all_num])
        if y is not None and self.cat_cols:
            self.target_encoder.fit(df[self.cat_cols], y)
        return self

    def transform(self, df):
        df = self._time_features(df)

        if not hasattr(self, "all_num"):
            self.time_cols = ["MONTH_sin", "MONTH_cos", "DAY_sin", "DAY_cos", "DOW_sin", "DOW_cos", "HOUR_sin", "HOUR_cos"]
            self.all_num = [c for c in self.num_cols + self.time_cols if c in df.columns]

        X_num = pd.DataFrame(self.num_imputer.transform(df[self.all_num]), columns=self.all_num, index=df.index)
        X_cat = self.target_encoder.transform(df[self.cat_cols]) if self.cat_cols else pd.DataFrame(index=df.index)
        X_cat.index = df.index
        return pd.concat([X_num, X_cat], axis=1)


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

# load and handle missing file gracefully (suppress xgboost pickle warning)
_xgb_pickle_warning = "If you are loading a serialized model"
try:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=f".*{_xgb_pickle_warning}.*", category=UserWarning)
        pipe = joblib.load(PIPE_PATH)
except Exception as e:
    sys.stderr.write(f"Failed to load pipeline from {PIPE_PATH}: {e}\n")
    sys.exit(1)

try:
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=f".*{_xgb_pickle_warning}.*", category=UserWarning)
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
            pred_log = model.predict(X)[0]
            pred = float(np.expm1(pred_log))
            if pred < 0:
                pred = 0.0
            print(pred)
        except Exception as e:
            # send error to stderr so Node can see it
            sys.stderr.write(f"Prediction error: {e}\n")
            sys.exit(1)
    else:
        sys.stderr.write("No input data provided\n")
        sys.exit(1)
