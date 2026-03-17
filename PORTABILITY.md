# Friday Portability Guide 🚀

If you are setting up Friday on a new computer, follow these steps to ensure everything works correctly.

## 1. Prerequisites
- **Node.js**: LTS version.
- **Chrome / Edge**: Friday integrates with these via its extension.

## 2. Setup Steps
1.  **Clone / Copy**: Copy the project folder to the new machine.
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
    *Note: The sidecar binary will be built automatically during this step.*

3.  **Environment Variables**:
    - Create a `.env` file in the root directory.
    - Add your keys:
      ```env
      GEMINI_API_KEY=your_key_here
      ZEP_API_KEY=your_key_here
      # ... other optional keys
      ```

## 3. Launching
Run the following command to start Friday:
```bash
npm run dev
```

## Troubleshooting
- **Sidecar Errors**: If you see `Failed to start`, double-check that the .NET 9.0 Desktop Runtime is installed.
