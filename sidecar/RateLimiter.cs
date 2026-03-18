using System;
using System.Collections.Generic;
using System.Collections.Concurrent;

namespace Friday.Sidecar
{
    internal static class RateLimiter
    {
        private static readonly ConcurrentDictionary<string, Queue<DateTime>> _requests = new ConcurrentDictionary<string, Queue<DateTime>>();
        private const int MAX_REQUESTS_PER_SECOND = 10;
        
        public static bool AllowRequest(string operation)
        {
            var now = DateTime.UtcNow;
            var queue = _requests.GetOrAdd(operation, _ => new Queue<DateTime>());
            
            lock (queue)
            {
                // Remove requests older than 1 second
                while (queue.Count > 0 && (now - queue.Peek()).TotalSeconds > 1)
                {
                    queue.Dequeue();
                }
                
                if (queue.Count >= MAX_REQUESTS_PER_SECOND)
                {
                    return false;
                }
                
                queue.Enqueue(now);
                return true;
            }
        }
    }
}
