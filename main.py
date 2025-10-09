# main.py
import os, requests
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.get("/")
def home():
    return "PubMed connector API is running!"

@app.get("/search")
def search():
    query = request.args.get("query", "")
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    params = {"db":"pubmed","term":query,"retmode":"json","retmax":5}
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return jsonify(r.json())

@app.get("/openapi.json")
def openapi():
    spec = {
      "openapi": "3.0.0",
      "info": {"title": "ChatGPT PubMed Connector", "version": "1.0.0"},
      "servers": [{"url": "https://exceptional-wanda-demitomo-9763a650.koyeb.app"}],
      "paths": {
        "/search": {
          "get": {
            "operationId": "pubmedSearch",
            "summary": "Search PubMed (E-utilities esearch)",
            "parameters": [
              {
                "name": "query",
                "in": "query",
                "required": True,
                "schema": {"type": "string"},
                "description": "PubMed search term (e.g., 'aspirin randomized trial')"
              }
            ],
            "responses": {
              "200": {
                "description": "PubMed esearch JSON",
                "content": {"application/json": {"schema": {"type": "object"}}}
              }
            }
          }
        }
      }
    }
    return jsonify(spec)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
