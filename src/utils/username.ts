const ADJECTIVES = [
  'blue', 'fast', 'cold', 'bright', 'dark', 'sharp', 'soft', 'wild',
  'calm', 'deep', 'flat', 'free', 'glad', 'gray', 'hard', 'high',
  'hot', 'keen', 'kind', 'lean', 'lone', 'long', 'loud', 'mild',
  'neat', 'new', 'nice', 'odd', 'old', 'open', 'pale', 'pink',
  'plain', 'pure', 'quick', 'rare', 'raw', 'real', 'red', 'rich',
  'round', 'safe', 'slim', 'slow', 'small', 'smart', 'still', 'sure',
  'tall', 'thin', 'tidy', 'tiny', 'true', 'vast', 'warm', 'wide',
  'wise', 'young', 'bold', 'brave', 'clear', 'cool', 'crisp', 'dense',
  'dull', 'fair', 'fine', 'firm', 'faint', 'fresh', 'great', 'green',
  'grim', 'harsh', 'heavy', 'hazy', 'idle', 'iron', 'jade', 'just',
  'late', 'light', 'lush', 'mute', 'near', 'noble', 'north', 'oak',
  'plum', 'prim', 'proud', 'quiet', 'rigid', 'rough', 'sage', 'salt',
  'sandy', 'seven', 'sheer', 'short', 'silver', 'sleek', 'spare', 'stark',
  'steep', 'stern', 'stiff', 'stone', 'storm', 'stout', 'swift', 'tangy',
];

const NOUNS = [
  'falcon', 'river', 'pine', 'stone', 'wolf', 'ember', 'coast', 'drift',
  'arrow', 'atlas', 'bark', 'bay', 'bear', 'bell', 'bird', 'blade',
  'blaze', 'bloom', 'bolt', 'bone', 'bow', 'brook', 'brush', 'cape',
  'cave', 'cedar', 'chalk', 'cloud', 'cove', 'crane', 'creek', 'crest',
  'crow', 'crown', 'dawn', 'deer', 'dune', 'dusk', 'dust', 'eagle',
  'echo', 'elm', 'fern', 'field', 'fjord', 'flame', 'flint', 'flood',
  'fog', 'forge', 'fork', 'frost', 'gale', 'gate', 'glade', 'glen',
  'gorge', 'grove', 'gulf', 'hawk', 'heath', 'hill', 'horn', 'ice',
  'inlet', 'iris', 'isle', 'jade', 'kelp', 'kite', 'lake', 'lark',
  'leaf', 'ledge', 'loch', 'lynx', 'mast', 'meadow', 'mesa', 'mist',
  'moon', 'moss', 'moth', 'mound', 'mule', 'oak', 'ore', 'otter',
  'pass', 'path', 'peak', 'perch', 'plum', 'pond', 'pool', 'raven',
  'reef', 'ridge', 'robin', 'rock', 'root', 'rush', 'sage', 'shore',
  'slope', 'smoke', 'snow', 'sparrow', 'spring', 'spruce', 'stream', 'swan',
];

export function generateUsername(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 900) + 100; // 100–999
  return `${adj}-${noun}-${num}`;
}

const PASSWORD_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';

export function generatePassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length])
    .join('');
}
