#!/usr/bin/env node

const net = require('node:net');

const LOCAL_AUTOMATION_PIPE_PATH = '\\\\.\\pipe\\multicli-discord-bridge-local-automation-v1';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const request = buildRequest(options);
  const response = await sendRequest(request);
  if (!response || response.ok !== true) {
    const message = response && typeof response.error === 'string' ? response.error : 'Unknown automation error.';
    throw new Error(message);
  }

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

function parseArgs(argv) {
  const options = {
    slot: undefined,
    text: false,
    state: false,
    screenshot: false,
    windowScreenshot: false,
    maxChars: undefined,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    switch (value) {
      case '--slot':
        options.slot = argv[index + 1];
        index += 1;
        break;
      case '--text':
        options.text = true;
        break;
      case '--state':
        options.state = true;
        break;
      case '--screenshot':
        options.screenshot = true;
        break;
      case '--window-screenshot':
        options.windowScreenshot = true;
        break;
      case '--max-chars':
        options.maxChars = argv[index + 1];
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${value}`);
    }
  }

  return options;
}

function buildRequest(options) {
  if (options.windowScreenshot) {
    ensureExclusive(options, 'window-screenshot');
    return { kind: 'observe-window-screenshot' };
  }

  if (options.state) {
    if (options.text || options.screenshot || options.windowScreenshot) {
      throw new Error('Use --state by itself or with only --slot.');
    }

    return {
      kind: 'observe-slot-state',
      slot: typeof options.slot === 'string' ? normalizeSlot(options.slot) : undefined
    };
  }

  const slot = normalizeSlot(options.slot);

  if (options.text === options.screenshot) {
    throw new Error('Choose exactly one of --text or --screenshot for slot observation.');
  }

  if (options.text) {
    return {
      kind: 'observe-slot-text',
      slot,
      maxChars: normalizeOptionalPositiveInteger(options.maxChars, '--max-chars')
    };
  }

  return {
    kind: 'observe-slot-screenshot',
    slot
  };
}

function ensureExclusive(options, selectedMode) {
  const flags = [options.text, options.state, options.screenshot, options.windowScreenshot].filter(Boolean).length;
  if (flags !== 1) {
    throw new Error(`Use ${selectedMode} by itself.`);
  }

  if (selectedMode !== 'window-screenshot' && typeof options.slot === 'string') {
    throw new Error('--slot cannot be combined with this mode.');
  }
}

function normalizeSlot(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Slot is required. Use --slot 1 or --slot slot1.');
  }

  const normalized = value.trim().toLowerCase().replace(/^slot-?/, '');
  if (!['1', '2', '3', '4', '5', '6', '7', '8'].includes(normalized)) {
    throw new Error('Slot must be 1-8 or slot1-slot8.');
  }

  return Number(normalized);
}

function normalizeOptionalPositiveInteger(value, flagName) {
  if (typeof value === 'undefined') {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

function sendRequest(request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(LOCAL_AUTOMATION_PIPE_PATH);
    let responseText = '';
    let settled = false;

    socket.setEncoding('utf8');
    socket.setTimeout(5000);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk) => {
      if (settled) {
        return;
      }

      responseText += chunk;
      const newlineIndex = responseText.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }

      settled = true;
      const payload = responseText.slice(0, newlineIndex).trim();
      socket.end();
      try {
        resolve(JSON.parse(payload));
      } catch (error) {
        reject(new Error(`Invalid automation response: ${formatError(error)}`));
      }
    });

    socket.on('end', () => {
      if (settled) {
        return;
      }

      settled = true;
      try {
        resolve(JSON.parse(responseText.trim()));
      } catch (error) {
        reject(new Error(`Invalid automation response: ${formatError(error)}`));
      }
    });

    socket.on('timeout', () => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      reject(new Error('Timed out waiting for the running bridge app.'));
    });

    socket.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(renderConnectionError(error)));
    });
  });
}

function renderConnectionError(error) {
  if (error && error.code === 'ENOENT') {
    return 'The running multicli-discord-bridge app was not found. Start the Electron app first.';
  }

  return formatError(error);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function printHelp() {
  process.stdout.write(
    [
      'Usage:',
      '  node scripts\\bridge-observe.cjs --slot slot3 --text',
      '  node scripts\\bridge-observe.cjs --state',
      '  node scripts\\bridge-observe.cjs --slot slot3 --state',
      '  node scripts\\bridge-observe.cjs --slot slot3 --screenshot',
      '  node scripts\\bridge-observe.cjs --window-screenshot',
      '',
      'Options:',
      '  --slot <slot>          Required for --text and --screenshot (1-8 or slot1-slot8)',
      '  --state                Return coordination slot state as JSON (optionally filter by --slot)',
      '  --text                 Return visible slot text as JSON',
      '  --screenshot           Capture a slot screenshot and return the saved file path as JSON',
      '  --window-screenshot    Capture the whole app window and return the saved file path as JSON',
      '  --max-chars <count>    Optional text limit for --text'
    ].join('\n') + '\n'
  );
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
