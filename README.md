# Banshee

Banshee lets you run, orchestrate, and observe CLI agents across providers. The project aims to provide a unified desktop interface for managing agent workflows.

## Architecture

- **Front-end:** React + Vite for the user interface.
- **Backend:** Tauri with a Rust core to deliver a lightweight, cross-platform desktop app.

## Setup

1. **Prerequisites**
   - Node.js and npm
   - Rust toolchain and Tauri prerequisites
2. **Install**
   ```bash
   npm install
   ```
3. **Run the web UI**
   ```bash
   npm run dev
   ```
4. **Run the desktop app**
   ```bash
   npm run dev:desktop
   ```
5. **Build for production**
   ```bash
   npm run build       # web
   npm run build:desktop  # desktop
   ```

## Contributing

Contributions are welcome!

1. Fork the repository and create a feature branch.
2. Install dependencies and run `npm run lint` to ensure code style.
3. Commit your changes and open a pull request describing your contribution.

By participating, you agree that your contributions will be licensed under the same [MIT license](LICENSE).

## License

This project is licensed under the [MIT License](LICENSE).
