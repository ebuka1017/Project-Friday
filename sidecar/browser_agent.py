import asyncio
import json
import sys
import os
import time
from browser_use import Agent, BrowserSession
from langchain_google_genai import ChatGoogleGenerativeAI

def emit(event_type: str, data: dict):
    """MiroFish-style structured event stream"""
    print(json.dumps({
        'event':     event_type,
        'timestamp': time.time(),
        'data':      data
    }), flush=True)

# Use the same key Friday uses
api_key = os.environ.get("GEMINI_API_KEY")
llm = ChatGoogleGenerativeAI(model='gemini-2.0-flash', google_api_key=api_key)

# Shared browser session for persistence
_shared_session = None

async def get_session():
    global _shared_session
    if _shared_session is None:
        _shared_session = BrowserSession(
            cdp_url='http://localhost:9222',
            keep_alive=True,
        )
    return _shared_session

async def run_task(task: str) -> dict:
    emit('agent_status', {'message': f'Starting task: {task}'})
    
    session = await get_session()

    async def step_callback(state):
        # Emit thoughts and actions for each step
        last_result = state.results[-1] if state.results else None
        if last_result:
             emit('agent_thought', {'reasoning': last_result.model_output.current_state.next_goal if last_result.model_output else 'Processing...'})
             if last_result.model_output and last_result.model_output.action:
                 emit('agent_step', {
                     'action': str(last_result.model_output.action[0]) if last_result.model_output.action else 'Thinking',
                     'url': state.url
                 })

    agent = Agent(
        task=task,
        llm=llm,
        browser_session=session,
        step_callback=step_callback
    )

    result = await agent.run()
    
    # Collect step history to stream back to Friday's HUD
    history = []
    # Note: browser-use history structure depends on version, 
    # but usually history is accessible after run()
    try:
        for action in agent.history.history:
            history.append({
                'action': action.model_output.current_state.next_goal if action.model_output else '',
                'url':    action.state.url if action.state else '',
            })
    except:
        pass

    return {
        'status':  'done',
        'result':  str(result),
        'history': history,
    }

async def main():
    # Read one JSON task per line from stdin, write result to stdout
    print(json.dumps({'status': 'ready', 'message': 'Browser agent sidecar initialized'}), flush=True)
    
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            task = msg.get('task', '')
            
            # Signal "started" immediately so Friday HUD can show spinner
            emit('agent_status', {'message': f'Starting browser agent: {task}'})

            result = await run_task(task)
            print(json.dumps(result), flush=True)

        except Exception as e:
            print(json.dumps({'status': 'error', 'error': str(e)}), flush=True)

if __name__ == '__main__':
    asyncio.run(main())
