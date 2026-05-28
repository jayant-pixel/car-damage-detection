import { spawn } from "node:child_process";

const child = spawn("netlify", ["dev"], {
  shell: true,
  stdio: ["inherit", "inherit", "pipe"]
});

let pendingErrorOutput = "";

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  pendingErrorOutput += chunk;
  const lines = pendingErrorOutput.split(/\r?\n/);
  pendingErrorOutput = lines.pop() || "";

  for (const line of lines) {
    writeErrorLine(line);
  }
});

child.stderr.on("end", () => {
  if (pendingErrorOutput) {
    writeErrorLine(pendingErrorOutput);
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function writeErrorLine(line) {
  if (isKnownNodeDeprecation(line)) return;
  process.stderr.write(`${line}\n`);
}

function isKnownNodeDeprecation(line) {
  return line.includes("[DEP0060] DeprecationWarning: The `util._extend` API is deprecated.")
    || line.includes("Use `node --trace-deprecation ...` to show where the warning was created");
}
