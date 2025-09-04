# Banshee

A Tauri + React application.

## Model configuration

Model API credentials can be provided without changing source code. Banshee reads
model settings from either a `.env` file or from the Tauri configuration and
exposes them to the React front-end through `@tauri-apps/api`.

### Using `.env`

Create a file named `.env` in the project root:

```
MODEL_API_ENDPOINT=https://api.example.com
MODEL_API_KEY=your_api_key
```

### Using `tauri.conf.json`

Instead of a `.env` file, add a `model` block to
`src-tauri/tauri.conf.json`:

```
{
  ...
  "model": {
    "apiEndpoint": "https://api.example.com",
    "apiKey": "your_api_key"
  }
}
```

During startup the app loads these values and merges them into the user
settings. They are accessible to the React app via the Tauri command
`get_model_config`, allowing users to adjust model configuration in the UI
without editing source files.

