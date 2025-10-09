import os
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.get("/")
def home():
    return "PubMed connector API is running!"

@app.get("/search")
def search():
    query = request.args.get("query", "")
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    params = {
        "db": "pubmed",
        "term": query,
        "retmode": "json",
        "retmax": 5
    }
    response = requests.get(url, params=params)
    return jsonify(response.json())

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
