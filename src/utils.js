// Constants and small helper functions (copied from your original app.js)
export const EMULATOR_DATA_PATH = 'https://cdn.emulatorjs.org/4.0.10/data/';
export const EMULATOR_LOADER_SCRIPT = 'https://cdn.emulatorjs.org/4.0.10/data/loader.js';

// Size threshold for warning toast (50 MB)
export const LARGE_FILE_THRESHOLD = 50 * 1024 * 1024;

// Supported file extensions to core mapping
export const CORE_EXTENSIONS = {
  // Nintendo
  nes: 'nes',
  snes: 'snes', smc: 'snes', sfc: 'snes',
  gba: 'gba',
  gb: 'gb',
  gbc: 'gbc',
  n64: 'n64', z64: 'n64', v64: 'n64',
  nds: 'nds',
  vb: 'beetle_vb',
  // Sega
  gen: 'segaMD', md: 'segaMD', smd: 'segaMD',
  gg: 'gamegear',
  sms: 'segaMS',
  // Atari & others
  a26: 'a2600',
  a78: 'a7800',
  lnx: 'lynx', lynx: 'lynx',
  pce: 'pce',
  ws: 'ws', wsc: 'ws',
  ngp: 'ngp', ngc: 'ngp',
};

// Priority list for picking ROMs from ZIP archives
export const ROM_PRIORITY = [
  'nes', 'snes', 'smc', 'sfc', 'gba', 'gbc', 'gb',
  'gen', 'md', 'smd', 'n64', 'z64', 'v64', 'nds',
  'pce', 'a26', 'a78', 'lnx', 'gg', 'sms', 'vb', 'ws', 'wsc', 'ngp'
];

export const SYSTEM_LABELS = {
  nes: 'Nintendo NES',
  snes: 'Super Nintendo',
  gba: 'Game Boy Advance',
  gb: 'Game Boy',
  gbc: 'Game Boy Color',
  segaMD: 'Sega Genesis / Mega Drive',
  gamegear: 'Sega Game Gear',
  segaMS: 'Sega Master System',
  beetle_vb: 'Virtual Boy',
  n64: 'Nintendo 64',
  nds: 'Nintendo DS',
  a2600: 'Atari 2600',
  a7800: 'Atari 7800',
  lynx: 'Atari Lynx',
  pce: 'PC Engine / TurboGrafx-16',
  ws: 'WonderSwan',
  ngp: 'Neo Geo Pocket',
  fbneo: 'Arcade (FBNeo)'
};


export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function generateMinimalNesRom(primaryColor = 0x21, secondaryColor = 0x30, thirdColor = 0x0F) {
  // 16-byte iNES Header + 16KB PRG ROM
  const totalSize = 16 + 16384;
  const bytes = new Uint8Array(totalSize);

  // iNES Header (NROM-128, Horizontal mirroring, CHR RAM)
  bytes[0] = 0x4E; // 'N'
  bytes[1] = 0x45; // 'E'
  bytes[2] = 0x53; // 'S'
  bytes[3] = 0x1A; // DOS EOF
  bytes[4] = 0x01; // 1 x 16KB PRG ROM bank
  bytes[5] = 0x00; // 0 x 8KB CHR ROM bank (CHR RAM)
  bytes[6] = 0x00; // Mapper 0
  bytes[7] = 0x00;

  // 6502 Machine Code starting at $8000 (offset 16 in ROM)
  const code = [
    0x78,             // $8000: SEI
    0xD8,             // $8001: CLD
    0xA2, 0x40,       // $8002: LDX #$40
    0x8E, 0x17, 0x40, // $8004: STX $4017 (disable APU frame IRQ)
    0xA2, 0xFF,       // $8007: LDX #$FF
    0x9A,             // $8009: TXS
    0xE8,             // $800A: INX (X = 0)
    0x8E, 0x00, 0x20, // $800B: STX $2000 (disable NMI)
    0x8E, 0x01, 0x20, // $800E: STX $2001 (disable rendering)

    // vblank wait 1: $8011
    0x2C, 0x02, 0x20, // $8011: BIT $2002
    0x10, 0xFB,       // $8014: BPL -5 ($8011)

    // vblank wait 2: $8016
    0x2C, 0x02, 0x20, // $8016: BIT $2002
    0x10, 0xFB,       // $8019: BPL -5 ($8016)

    // Point PPU to Palette RAM ($3F00): $801B
    0xA9, 0x3F,       // $801B: LDA #$3F
    0x8D, 0x06, 0x20, // $801D: STA $2006
    0xA9, 0x00,       // $8020: LDA #$00
    0x8D, 0x06, 0x20, // $8022: STA $2006

    // Write background palette color entry 0: $8025
    0xA9, primaryColor, // $8025: LDA #primaryColor
    0x8D, 0x07, 0x20,   // $8027: STA $2007

    // Enable background rendering: $802A
    0xA9, 0x0A,         // $802A: LDA #$0A (show background in leftmost 8px & main)
    0x8D, 0x01, 0x20,   // $802C: STA $2001

    // Infinite loop at $802F: JMP $802F (Corrected branch target)
    0x4C, 0x2F, 0x80    // $802F: JMP $802F (4C 2F 80 loops on itself)
  ];

  for (let i = 0; i < code.length; i++) {
    bytes[16 + i] = code[i];
  }

  // 6502 Interrupt Vectors at end of 16KB bank ($FFFA-$FFFF, offset 16 + 16384 - 6 = 16394)
  // NMI Vector ($8000)
  bytes[16394] = 0x00;
  bytes[16395] = 0x80;
  // Reset Vector ($8000)
  bytes[16396] = 0x00;
  bytes[16397] = 0x80;
  // IRQ Vector ($8000)
  bytes[16398] = 0x00;
  bytes[16399] = 0x80;

  return new Blob([bytes], { type: 'application/octet-stream' });
}
