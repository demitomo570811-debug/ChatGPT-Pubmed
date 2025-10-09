import os
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.get("/")
def home():
    return "PubMed connector API is running on Koyeb!"

@app.get("/search")
def search():
    q = request.args.get("query", "")
    return jsonify({"query": q, "hits": []})

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
