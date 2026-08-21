import asyncio
import json
import sys
import os
import time
from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig

def emit(event_type: str, data: dict):
    print(json.dumps({
        'event': event_type,
        'timestamp': time.time(),
        'data': data
    }), flush=True)

async def run_task(task: str, system_instructions: str = None) -> dict:
    config = LocalAgentConfig(
        system_instructions=system_instructions or "You are Friday, an autonomous assistant.",
        capabilities=CapabilitiesConfig()
    )
    
    tokens = []
    
    async with Agent(config) as agent:
        response = await agent.chat(task)
        
        async def stream_content():
            async for token in response:
                tokens.append(token)
                emit('agent_token', {'token': token})
                
        async def stream_thoughts():
            async for thought in response.thoughts:
                emit('agent_thought', {'reasoning': thought})
                
        async def stream_tools():
            async for call in response.tool_calls:
                emit('agent_step', {
                    'action': f"Calling tool {call.name} with args: {json.dumps(call.args)}",
                    'url': ''
                })
                
        await asyncio.gather(stream_content(), stream_thoughts(), stream_tools())
        
    return {
        'status': 'done',
        'result': ''.join(tokens)
    }

async def main():
    emit('agent_status', {'message': 'Antigravity SDK sub-agent initialized'})
    
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            task = msg.get('task', '')
            system_instructions = msg.get('system_instructions', '')
            
            emit('agent_status', {'message': f'Starting Antigravity agent task: {task}'})
            result = await run_task(task, system_instructions)
            print(json.dumps(result), flush=True)
            
        except Exception as e:
            print(json.dumps({'status': 'error', 'error': str(e)}), flush=True)

if __name__ == '__main__':
    asyncio.run(main())
