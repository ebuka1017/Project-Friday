import asyncio
import json
import os
import sys
from zep_cloud.client import AsyncZep

# API Key should be in .env
ZEP_API_KEY = os.environ.get("ZEP_API_KEY")

async def save_to_memory(user_id: str, content: str):
    if not ZEP_API_KEY:
        return {"success": False, "error": "ZEP_API_KEY not found in environment."}
    
    client = AsyncZep(api_key=ZEP_API_KEY)
    try:
        # MiroFish style: Add as fact to the graph
        await client.graph.add(user_id=user_id, type='text', data=content)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def search_memory(user_id: str, query: str):
    if not ZEP_API_KEY:
        return {"success": False, "error": "ZEP_API_KEY not found in environment."}
    
    client = AsyncZep(api_key=ZEP_API_KEY)
    try:
        # Search the knowledge graph (entities and relationships)
        results = await client.graph.search(user_id=user_id, query=query, limit=5)
        facts = [r.fact for r in results.edges] if hasattr(results, 'edges') else []
        return {"success": True, "facts": facts}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def main():
    # Ready signal
    print(json.dumps({"status": "ready", "module": "memory"}), flush=True)
    
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try:
            msg = json.loads(line)
            action = msg.get("action")
            user_id = msg.get("user_id", "default_user")
            
            if action == "save":
                res = await save_to_memory(user_id, msg.get("content"))
                print(json.dumps(res), flush=True)
            elif action == "search":
                res = await search_memory(user_id, msg.get("query"))
                print(json.dumps(res), flush=True)
                
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
