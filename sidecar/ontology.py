import asyncio
import json
import os
import sys
from langchain_google_genai import ChatGoogleGenerativeAI

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
llm = ChatGoogleGenerativeAI(model='gemini-2.0-flash', google_api_key=GEMINI_API_KEY)

async def extract_ontology(text: str):
    prompt = f"""
    Extract key entities and their relationships from the following text.
    Return a structured JSON object with 'entities' and 'relationships'.
    
    Entities should have: name, type (person, org, event, concept), description.
    Relationships should have: source, target, relation.
    
    Text:
    {text}
    """
    # Force JSON output
    response = llm.invoke(prompt)
    content = response.content
    
    # Cleanup markdown backticks if present
    if "```json" in content:
        content = content.split("```json")[1].split("```")[0].strip()
    elif "```" in content:
         content = content.split("```")[1].split("```")[0].strip()

    return json.loads(content)

async def main():
    print(json.dumps({"status": "ready", "module": "ontology"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try:
            msg = json.loads(line)
            if msg.get("action") == "extract":
                ontology = await extract_ontology(msg.get("text", ""))
                print(json.dumps({"status": "done", "ontology": ontology}), flush=True)
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
