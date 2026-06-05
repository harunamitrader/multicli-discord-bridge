#!/usr/bin/env node

const net = require('node:net');

const LOCAL_AUTOMATION_PIPE_PATH = '\\\\.\\pipe\\multicli-discord-bridge-local-automation-v1';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const text = await resolveText(options);
  const slot = normalizeSlot(options.slot);
  const from = normalizeFromLabel(options.from);
  const originSlot = typeof options.originSlot === 'string' ? normalizeSlot(options.originSlot) : undefined;
  validateNotifyOptions({
    slot,
    originSlot,
    notifyOnComplete: options.notifyOnComplete,
    noEnter: options.noEnter
  });
  const request = {
    kind: 'send-text',
    slot,
    from,
    text,
    pressEnter: !options.noEnter,
    originSlot,
    notifyOnComplete: options.notifyOnComplete,
    client: options.client || 'bridge-send-slot'
  };

  const response = await sendRequest(request);
  if (!response || response.ok !== true) {
    const message = response && typeof response.error === 'string' ? response.error : 'Unknown automation error.';
    throw new Error(message);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `Sent ${response.textLength} chars to slot${response.slot} from ${response.from} (${response.sessionId})${
      response.pressEnter ? ' with Enter' : ' without Enter'
    }${response.deliveryCheck ? ` [delivery: ${response.deliveryCheck.verdict}]` : ''}${
      response.completionNotification
        ? ` [completion notify -> slot${response.completionNotification.originSlot} id=${response.completionNotification.requestId}]`
        : ''
    }.\n`
  );
}

function parseArgs(argv) {
  const options = {
    slot: undefined,
    from: undefined,
    text: undefined,
    noEnter: false,
    originSlot: undefined,
    notifyOnComplete: false,
    json: false,
    client: undefined,
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
        options.text = argv[index + 1];
        index += 1;
        break;
      case '--from':
        options.from = argv[index + 1];
        index += 1;
        break;
      case '--origin-slot':
        options.originSlot = argv[index + 1];
        index += 1;
        break;
      case '--client':
        options.client = argv[index + 1];
        index += 1;
        break;
      case '--no-enter':
        options.noEnter = true;
        break;
      case '--notify-on-complete':
        options.notifyOnComplete = true;
        break;
      case '--json':
        options.json = true;
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

async function resolveText(options) {
  if (typeof options.text === 'string') {
    if (options.text.length === 0) {
      throw new Error('Text cannot be empty.');
    }

    return options.text;
  }

  if (process.stdin.isTTY) {
    throw new Error('Text is required. Pass --text or pipe text to stdin.');
  }

  const stdinText = await readStdin();
  if (stdinText.length === 0) {
    throw new Error('Stdin text is empty.');
  }

  return stdinText;
}

function normalizeFromLabel(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('From label is required. Use --from slot3, --from human, or --from external:claude-desktop.');
  }

  const normalized = value.trim().toLowerCase();
  if (/^slot[1-8]$/.test(normalized) || normalized === 'human' || normalized === 'cron' || /^external:[a-z0-9._-]+$/.test(normalized)) {
    return normalized;
  }

  throw new Error('From label must be slot1-slot8, human, cron, or external:<label>.');
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

function validateNotifyOptions(options) {
  if (!options.notifyOnComplete && typeof options.originSlot !== 'undefined') {
    throw new Error('--origin-slot requires --notify-on-complete.');
  }

  if (options.notifyOnComplete && typeof options.originSlot === 'undefined') {
    throw new Error('--notify-on-complete requires --origin-slot.');
  }

  if (options.notifyOnComplete && options.slot === options.originSlot) {
    throw new Error('--origin-slot must be different from --slot.');
  }

  if (options.notifyOnComplete && options.noEnter) {
    throw new Error('--notify-on-complete requires Enter to be enabled.');
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => {
      resolve(buffer);
    });
    process.stdin.on('error', (error) => {
      reject(error);
    });
  });
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
      '  node scripts\\bridge-send-slot.cjs --slot slot3 --from human --text "Hello"',
      '  Get-Content .\\prompt.txt | node scripts\\bridge-send-slot.cjs --slot slot3 --from slot2',
      '',
      'Options:',
      '  --slot <slot>    Required. 1-8, slot1-slot8, or slot-1-slot-8',
      '  --from <label>   Required. slot1-slot8, human, cron, or external:<label>',
      '  --text <text>    Optional when text is piped through stdin',
      '  --no-enter       Send text without the trailing Enter',
      '  --notify-on-complete  Optional. Off by default, even for skills',
      '  --origin-slot <slot>  Required only with --notify-on-complete',
      '  --json           Print the response as JSON',
      '  --client <name>  Optional client label for logs'
    ].join('\n') + '\n'
  );
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
