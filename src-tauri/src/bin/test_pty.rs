use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::thread;
use std::time::Duration;

fn main() {
    println!("Testing PTY with character input...");
    
    let pty_system = native_pty_system();
    
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .expect("Failed to create PTY");
    
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    println!("Using shell: {}", shell);
    
    let mut cmd = CommandBuilder::new(&shell);
    cmd.env("TERM", "xterm-256color");
    
    let mut child = pair.slave.spawn_command(cmd)
        .expect("Failed to spawn shell");
    
    // Get reader and writer
    let mut reader = pair.master.try_clone_reader().expect("Failed to clone reader");
    let mut writer = pair.master.take_writer().expect("Failed to get writer");
    
    // Start reader thread
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    println!("EOF");
                    break;
                }
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buffer[..n]);
                    print!("{}", output);
                }
                Err(e) => {
                    eprintln!("Read error: {}", e);
                    break;
                }
            }
        }
    });
    
    // Wait for shell to initialize
    thread::sleep(Duration::from_millis(1000));
    
    // Send 'l' character
    println!("\n--- Sending 'l' ---");
    writer.write_all(b"l").expect("Failed to write");
    writer.flush().expect("Failed to flush");
    
    thread::sleep(Duration::from_millis(500));
    
    // Send 's' character
    println!("\n--- Sending 's' ---");
    writer.write_all(b"s").expect("Failed to write");
    writer.flush().expect("Failed to flush");
    
    thread::sleep(Duration::from_millis(500));
    
    // Send Enter
    println!("\n--- Sending Enter ---");
    writer.write_all(b"\r").expect("Failed to write");
    writer.flush().expect("Failed to flush");
    
    thread::sleep(Duration::from_secs(2));
    
    // Send exit
    println!("\n--- Sending exit ---");
    writer.write_all(b"exit\r").expect("Failed to write");
    
    thread::sleep(Duration::from_millis(500));
    
    // Kill the child if still running
    child.kill().ok();
    
    // Wait for reader thread
    reader_thread.join().ok();
    
    println!("\nTest complete");
}