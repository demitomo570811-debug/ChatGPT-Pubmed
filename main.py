import os, requests
from flask import Flask, request, jsonify
from flask_cors import CORS        # ← ここで import

app = Flask(__name__)
CORS(app)                          # ← app 作成の“後”に呼ぶ

NCBI_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
NCBI_API_KEY = os.getenv("NCBI_API_KEY")  # 任意
NCBI_TOOL = "chatgpt-pubmed-connector"    # 任意の識別子
NCBI_EMAIL = os.getenv("NCBI_EMAIL", "")  # 任意（推奨）

def ncbi_params(extra=None):
    p = {"tool": NCBI_TOOL}
    if NCBI_API_KEY:
        p["api_key"] = NCBI_API_KEY
    if NCBI_EMAIL:
        p["email"] = NCBI_EMAIL
    if extra:
        p.update(extra)
    return p

@app.get("/")
def home():
    return "PubMed connector API is running on Koyeb! v2"  # ←反映確認用にv2

@app.get("/search")
def search():
    query = request.args.get("query", "").strip()
    retmax = int(request.args.get("retmax", 5))
    if not query:
        return jsonify({"error": "query required"}), 400

    # 1) esearch: PMIDs を取得（フィールド指定 + 関連度順）
    term = f'(({query})[MeSH Terms] OR ({query})[Title/Abstract]) AND english[lang]'
    esearch_params = ncbi_params({
        "db": "pubmed",
        "term": term,
        "retmode": "json",
        "retmax": retmax,
        "sort": "relevance",
    })
    r = requests.get(f"{NCBI_BASE}/esearch.fcgi", params=esearch_params, timeout=20)
    r.raise_for_status()
    data = r.json()
    idlist = data.get("esearchresult", {}).get("idlist", [])

    if not idlist:
        return jsonify({"query": query, "hits": []})

    # 2) esummary: 各PMIDのメタデータ取得
    esummary_params = ncbi_params({
        "db": "pubmed",
        "id": ",".join(idlist),
        "retmode": "json",
    })
    r2 = requests.get(f"{NCBI_BASE}/esummary.fcgi", params=esummary_params, timeout=20)
    r2.raise_for_status()
    sumdata = r2.json().get("result", {})

    hits = []
    for pmid in idlist:
        item = sumdata.get(pmid, {})
        title = item.get("title")
        journal = item.get("fulljournalname") or (item.get("source") if isinstance(item.get("source"), str) else None)
        year = None
        if isinstance(item.get("pubdate"), str):
            year = item["pubdate"].split(" ")[0][:4]
        authors = [a.get("name") for a in item.get("authors", []) if a.get("name")]
        link = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
        hits.append({
            "pmid": pmid,
            "title": title,
            "journal": journal,
            "year": year,
            "authors": authors[:10],
            "url": link
        })

    return jsonify({"query": query, "hits": hits})

@app.get("/openapi.json")
def openapi():
    base_url = os.getenv(
        "PUBLIC_BASE_URL",
        "https://exceptional-wanda-demitomo-9763a650.koyeb.app"
    )
    spec = {
      "openapi": "3.0.3",
      "info": {
        "title": "ChatGPT PubMed Connector",
        "version": "1.2.0",
        "description": "Search PubMed via NCBI E-utilities and return brief metadata."
      },
      "servers": [{"url": base_url}],
      "paths": {
        "/search": {
          "get": {
            "operationId": "pubmedSearch",
            "summary": "Search PubMed and return titles/authors/journal/year",
            "parameters": [
              {
                "name": "query",
                "in": "query",
                "required": True,
                "schema": {"type": "string"},
                "description": "PubMed search term (e.g., \"aspirin randomized trial\")"
              },
              {
                "name": "retmax",
                "in": "query",
                "required": False,
                "schema": {"type": "integer", "default": 5, "minimum": 1, "maximum": 50},
                "description": "Max results (1–50)"
              }
            ],
            "responses": {
              "200": {
                "description": "OK",
                "content": {
                  "application/json": {
                    "schema": {
                      "$ref": "#/components/schemas/SearchResponse"
                    },
                    "examples": {
                      "example": {
                        "summary": "Sample",
                        "value": {
                          "query": "aspirin",
                          "hits": [
                            {
                              "pmid": "38839268",
                              "title": "Low-dose aspirin for the prevention of atherosclerotic cardiovascular disease.",
                              "journal": "European heart journal",
                              "year": "2024",
                              "authors": ["Patrono C"],
                              "url": "https://pubmed.ncbi.nlm.nih.gov/38839268/"
                            }
                          ]
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "components": {
        "schemas": {
          "Hit": {
            "type": "object",
            "properties": {
              "pmid":   {"type": "string"},
              "title":  {"type": "string"},
              "journal":{"type": "string", "nullable": True},
              "year":   {"type": "string", "nullable": True},
              "authors":{"type": "array", "items": {"type": "string"}},
              "url":    {"type": "string", "format": "uri"}
            },
            "required": ["pmid", "title", "url"]
          },
          "SearchResponse": {
            "type": "object",
            "properties": {
              "query": {"type": "string"},
              "hits":  {"type": "array", "items": {"$ref": "#/components/schemas/Hit"}}
            },
            "required": ["query", "hits"]
          }
        }
      }
    }
    return jsonify(spec)


@app.get("/__debug_esearch")
def __debug_esearch():
    q = request.args.get("q", "aspirin")
    params = {
        "db": "pubmed",
        "term": q,
        "retmode": "json",
        "retmax": 5,
        "sort": "relevance",
    }
    r = requests.get(f"{NCBI_BASE}/esearch.fcgi", params=params, timeout=20)
    return jsonify({"url": r.url, "status": r.status_code, "json": r.json()})

@app.get("/version")
def version():
    return jsonify({"version": "v2"})

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    app.run(host="0.0.0.0", port=port)
