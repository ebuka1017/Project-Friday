import asyncio
import json
import sys
import time

async def run_parallel_tasks(tasks: list):
    """
    Spawn multiple tasks in parallel and collect results.
    Each task should describe an agent goal.
    """
    async def simulate_task(task):
        # In a real implementation, this would spawn a new Agent instance
        await asyncio.sleep(2) # Simulate work
        return {"id": task['id'], "result": f"Completed: {task['goal']}"}

    results = await asyncio.gather(*[simulate_task(t) for t in tasks])
    return results

async def main():
    print(json.dumps({"status": "ready", "module": "parallel"}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        try:
            msg = json.loads(line)
            if msg.get("action") == "run_parallel":
                results = await run_parallel_tasks(msg.get("tasks", []))
                print(json.dumps({"status": "done", "results": results}), flush=True)
        except Exception as e:
            print(json.dumps({"status": "error", "error": str(e)}), flush=True)

if __name__ == "__main__":
    asyncio.run(main())
