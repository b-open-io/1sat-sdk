#!/usr/bin/env bun
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execAsync = promisify(exec);

async function extractMedia(txid: string, outputDir?: string): Promise<void> {
  if (!txid || txid.length !== 64) {
    throw new Error("Invalid transaction ID. Must be 64 hex characters.");
  }

  const outputPath = outputDir ? path.resolve(outputDir) : process.cwd();

  console.log(`Extracting media from transaction: ${txid}`);
  console.log(`Output directory: ${outputPath}\n`);

  try {
    const cmd = outputDir
      ? `txex ${txid} -o "${outputPath}"`
      : `txex ${txid}`;

    const { stdout, stderr } = await execAsync(cmd);

    if (stderr) {
      console.error("Warning:", stderr);
    }

    console.log("✅ Extraction complete!");
    console.log(stdout);

  } catch (error: any) {
    if (error.message.includes("command not found: txex")) {
      throw new Error(
        "txex CLI not installed. Install with: bun add -g txex"
      );
    }
    if (error.message.includes("not found") || error.message.includes("404")) {
      throw new Error(`Transaction ${txid} not found on blockchain`);
    }
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: bun run extract.ts <txid> [output-directory]");
  console.error("");
  console.error("Examples:");
  console.error("  bun run extract.ts abc123def456...");
  console.error("  bun run extract.ts abc123def456... ./downloads");
  process.exit(1);
}

extractMedia(args[0], args[1]).catch(e => {
  console.error("❌ Error:", e.message);
  process.exit(1);
});
