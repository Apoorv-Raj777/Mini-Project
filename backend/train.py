import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder
import joblib

# Load CSV
data = pd.read_csv("historical_audits.csv")

# Encode categorical data
data["crowd_density"] = LabelEncoder().fit_transform(data["crowd_density"])
data["cctv"] = data["cctv"].map({"yes": 1, "no": 0})

# Features and target
X = data[["lighting", "visibility", "crowd_density", "cctv"]]
y = data["overall_safe"]

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train model
model = LogisticRegression()
model.fit(X_train, y_train)

# Save model
joblib.dump(model, "safety_model.joblib")

print("✅ Model trained and saved as safety_model.joblib")
