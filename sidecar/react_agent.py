import asyncio
import json
import os
import sys
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import HumanMessage, ToolMessage, AIMessage

# API Key
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
llm = ChatGoogleGenerativeAI(model='gemini-2.0-flash', google_api_key=GEMINI_API_KEY)

async def run_react_task(goal: str, tools_definition: list):
    """
    Standard ReACT loop: Reason -> Act -> Observe
    """
    messages = [HumanMessage(content=goal)]
    llm_with_tools = llm.bind_tools(tools_definition)
    
    for _ in range(10): # Max 10 steps
        response = llm_with_tools.invoke(messages)
        messages.append(response)
        
        if not response.tool_calls:
            return response.content
            
        # Signal main process to execute tools and return results
        # In this simplified sidecar, we emit the tool call and wait for input
        print(json.dumps({
            "event": "tool_call",
            "calls": [{"name": tc['name'], "args": tc['args'], "id": tc['id']} for tc in response.tool_calls]
        }), flush=True)
        
        # Wait for tool result on stdin
        line = await asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline)
        if not line: break
        
        results = json.loads(line)
        for res in results:
            messages.append(ToolMessage(content=str(res['output']), tool_call_id=res['id']))

    return "Max steps reached or error."

async def main():
    print(json.dumps({"status": "ready", "module": "react"}), flush=True)
    # ReACT loop implementation details can get complex; 
    # for Friday, we'll expose a 'reason' endpoint that suggests the next best tool.
    
if __name__ == "__main__":
    asyncio.run(main())
