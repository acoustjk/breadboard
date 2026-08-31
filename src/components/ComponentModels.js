/**
 * ComponentModels.js
 * Extended Circuit Component Models with Transistors (NPN & PNP BJT) v=1070.
 */

export function getResistorColorBands(resistance, isConfigured = true) {
    if (!isConfigured || !resistance || isNaN(resistance) || resistance <= 0) {
        return ['#94a3b8', '#94a3b8', '#94a3b8', '#cbd5e1'];
    }

    const digitColors = [
        '#2d3436', // 0 Black
        '#795548', // 1 Brown
        '#d63031', // 2 Red
        '#e67e22', // 3 Orange
        '#f1c40f', // 4 Yellow
        '#2ecc71', // 5 Green
        '#3498db', // 6 Blue
        '#9b59b6', // 7 Violet
        '#95a5a6', // 8 Gray
        '#ffffff'  // 9 White
    ];

    const exp = Math.floor(Math.log10(resistance));
    const normalized = resistance / Math.pow(10, exp - 1);
    let d1 = Math.floor(normalized);
    let d2 = Math.round((normalized - d1) * 10);
    if (d2 >= 10) {
        d1 += 1;
        d2 = 0;
    }

    const multExp = exp - 1;
    let multColor = '#2d3436';
    if (multExp >= 0 && multExp < digitColors.length) {
        multColor = digitColors[multExp];
    } else if (multExp === -1) {
        multColor = '#d4af37';
    } else if (multExp === -2) {
        multColor = '#c0c0c0';
    }

    const c1 = digitColors[Math.min(9, Math.max(0, d1))];
    const c2 = digitColors[Math.min(9, Math.max(0, d2))];
    const c4 = '#d4af37';

    return [c1, c2, multColor, c4];
}

export const TRANSISTOR_CATALOG = {
    '2N3904': { name: '2N3904 (NPN)', polarity: 'NPN', beta: 100, pinout: 'EBC', desc: '범용 NPN 소신호 트랜지스터 (EBC TO-92)' },
    '2N3906': { name: '2N3906 (PNP)', polarity: 'PNP', beta: 100, pinout: 'EBC', desc: '범용 PNP 소신호 트랜지스터 (EBC TO-92)' },
    '2N2222': { name: '2N2222 (NPN)', polarity: 'NPN', beta: 150, pinout: 'EBC', desc: '고전류 NPN 스위칭 트랜지스터 (EBC TO-92)' },
    'C1815':  { name: 'KSC1815 (NPN)', polarity: 'NPN', beta: 200, pinout: 'ECB', desc: '아시아 표준 NPN 저소음 트랜지스터 (ECB TO-92)' },
    'A1015':  { name: 'KSA1015 (PNP)', polarity: 'PNP', beta: 200, pinout: 'ECB', desc: '아시아 표준 PNP 저소음 트랜지스터 (ECB TO-92)' },
    '2SK30A': { name: '2SK30A / K30 (N-JFET)', polarity: 'N-JFET', beta: 200, pinout: 'SDG', desc: 'KCA PNM 통신실기 표준 N채널 JFET 아날로그 스위치 (SDG TO-92)' }
};

export const IC_CATALOG = {
    'LF356': { name: 'LF356 JFET Op-Amp', pins: 8, desc: '통신설비기능장 PNM 회로 표준 고속 JFET 입력 연산증폭기' },
    'LM301': { name: 'LM301 Precision Op-Amp', pins: 8, desc: '단일 정밀 연산 증폭기 (Super-Beta Input DIP-8 Op-Amp)' },
    'NE555': { name: 'NE555 Precision Timer', pins: 8, desc: '단일 정밀 타이머 / 아스타블 멀티바이브레이터' },
    'NE556': { name: 'NE556 Dual Timer', pins: 14, desc: '듀얼 555 듀얼 타이머 IC' },
    'LM358': { name: 'LM358 Dual Op-Amp', pins: 8, desc: '저전력 듀얼 연산 증폭기' },
    'LM741': { name: 'LM741 Op-Amp', pins: 8, desc: '범용 단일 연산 증폭기' },
    'LM386': { name: 'LM386 Audio Power Amp', pins: 8, desc: '저전압 오디오 파워 증폭기' },
    'LM393': { name: 'LM393 Dual Comparator', pins: 8, desc: '듀얼 전압 비교기' },
    'LM7805': { name: 'LM7805 +5V Regulator', pins: 8, desc: '+5V 정전압 레귤레이터' },
    'LM7812': { name: 'LM7812 +12V Regulator', pins: 8, desc: '+12V 정전압 레귤레이터' },
    'LM317': { name: 'LM317 Adjustable Regulator', pins: 8, desc: '가변 전압 레귤레이터' },
    '74HC00': { name: '74HC00 Quad NAND Gate', pins: 14, desc: '4채널 2입력 NAND 논리 게이트' },
    '74HC02': { name: '74HC02 Quad NOR Gate', pins: 14, desc: '4채널 2입력 NOR 논리 게이트' },
    '74HC04': { name: '74HC04 Hex Inverter', pins: 14, desc: '6채널 NOT 반전 게이트' },
    '74HC08': { name: '74HC08 Quad AND Gate', pins: 14, desc: '4채널 2입력 AND 논리 게이트' },
    '74HC32': { name: '74HC32 Quad OR Gate', pins: 14, desc: '4채널 2입력 OR 논리 게이트' },
    '74HC86': { name: '74HC86 Quad XOR Gate', pins: 14, desc: '4채널 2입력 XOR 논리 게이트' },
    '74HC595': { name: '74HC595 8-Bit Shift Register', pins: 16, desc: '8비트 시리얼-인/패러렐-아웃 시프트 레지스터' },
    'CD4017': { name: 'CD4017 Decade Counter', pins: 16, desc: '10진 디케이드 카운터 / 존슨 시퀀서' },
    'CD4026': { name: 'CD4026 7-Seg Counter', pins: 16, desc: '7세그먼트 디스플레이 카운터 드라이버' },
    'CD4049': { name: 'CD4049 Hex Inverting Buffer', pins: 16, desc: '6채널 CMOS 반전 버퍼 / 컨버터 (DIP-16)' },
    'CD4069': { name: 'CD4069 Hex Inverter', pins: 14, desc: '6채널 CMOS 반전 게이트 / 인버터 (DIP-14)' },
    'CD4510': { name: 'CD4510 BCD Up/Down Counter', pins: 16, desc: 'BCD 10진 업/다운 프리셋 카운터 (DIP-16)' },
    'CD4027': { name: 'CD4027 Dual J-K Flip-Flop', pins: 16, desc: '듀얼 J-K 플립플롭 (Set/Reset 포함 DIP-16)' },
    '74LS393': { name: '74LS393 Dual 4-Bit Binary Counter', pins: 14, desc: '듀얼 4비트 이진 리플 카운터 (DIP-14)' },
    '74LS151': { name: '74LS151 8-to-1 Line Multiplexer', pins: 16, desc: '8-to-1 데이터 셀렉터 / 멀티플렉서 (DIP-16)' },
    '74LS93':  { name: '74LS93 4-Bit Binary Counter', pins: 14, desc: '4비트 이진 리플 카운터 (DIP-14)' },
    '74LS86':  { name: '74LS86 Quad 2-Input XOR Gate', pins: 14, desc: '4채널 2입력 Exclusive-OR 게이트 (DIP-14)' }
};

export class BJTTransistor {
    constructor(id, transType = '2N3904', pinEmitter = 'B1_E20', pinBase = 'B1_F20', pinCollector = 'B1_G20') {
        this.id = id;
        this.type = 'BJT';
        this.transType = transType;
        const catalogMeta = TRANSISTOR_CATALOG[transType] || TRANSISTOR_CATALOG['2N3904'];
        this.polarity = catalogMeta.polarity;
        this.beta = catalogMeta.beta || 100.0;
        this.pinEmitter = pinEmitter;
        this.pinBase = pinBase;
        this.pinCollector = pinCollector;
        this.pinA = pinEmitter;
        this.pinB = pinCollector;
        this.isConfigured = true;
    }
}

export class Resistor {
    constructor(id, pinA, pinB, resistance = 1000, isConfigured = false) {
        this.id = id;
        this.type = 'R';
        this.pinA = pinA;
        this.pinB = pinB;
        this.resistance = resistance;
        this.isConfigured = isConfigured;
    }

    getConductance() {
        return 1.0 / (this.resistance || 1e6);
    }

    getBands() {
        return getResistorColorBands(this.resistance, this.isConfigured);
    }
}

export class Capacitor {
    constructor(id, pinA, pinB, capacitance = 10e-6, isConfigured = false, capType = 'ELEC') {
        this.id = id;
        this.type = 'C';
        this.capType = capType;
        this.pinA = pinA;
        this.pinB = pinB;
        this.capacitance = capacitance;
        this.vCap = 0;
        this.iCap = 0;
        this.isConfigured = isConfigured;
    }

    reset() {
        this.vCap = 0;
        this.iCap = 0;
    }

    getCompanionModel(dt) {
        const Geq = (2.0 * (this.capacitance || 1e-6)) / dt;
        const Ieq = Geq * this.vCap + this.iCap;
        return { Geq, Ieq, Req: 1.0 / Geq };
    }

    updateState(vDiff, dt) {
        const capVal = this.capacitance || 1e-6;
        const Geq = (2.0 * capVal) / dt;
        const vNew = (isNaN(vDiff) || !isFinite(vDiff)) ? 0 : vDiff;
        this.iCap = Geq * (vNew - this.vCap) - this.iCap;
        this.vCap = vNew;
    }
}

export class Diode {
    constructor(id, pinA, pinB, vForward = 0.7) {
        this.id = id;
        this.type = 'DIODE';
        this.pinA = pinA;
        this.pinB = pinB;
        this.vForward = vForward;
        this.isConfigured = true;
    }
}

export class ZenerDiode {
    constructor(id, pinA, pinB, vZener = 5.1, vForward = 0.7) {
        this.id = id;
        this.type = 'ZENER';
        this.pinA = pinA;
        this.pinB = pinB;
        this.vZener = vZener;
        this.vForward = vForward;
        this.isConfigured = true;
    }
}

export class Potentiometer {
    constructor(id, pinA, pinB, totalResistance = 10000, ratio = 0.5) {
        this.id = id;
        this.type = 'POT';
        this.pinA = pinA;
        this.pinB = pinB;
        this.totalResistance = totalResistance;
        this.ratio = Math.max(0.01, Math.min(0.99, ratio));
        this.isConfigured = true;
    }

    getEffectiveResistance() {
        return Math.max(1, this.totalResistance * this.ratio);
    }
}

export class DIPChip {
    constructor(id, icType = 'NE555', pinA = 'B1_E15', pinB = 'B1_F15') {
        this.id = id;
        this.type = 'IC';
        this.icType = icType;
        const catalogMeta = IC_CATALOG[icType] || IC_CATALOG['NE555'];
        this.pins = catalogMeta ? catalogMeta.pins : 8;
        this.pinA = pinA;
        this.pinB = pinB;
        this.isConfigured = true;
        this.vOut = 0;
    }
}

export class DCSource {
    constructor(id, pinA, pinB, voltage = 5.0, isConfigured = true) {
        this.id = id;
        this.type = 'VDC';
        this.pinA = pinA;
        this.pinB = pinB;
        this.voltage = voltage;
        this.isConfigured = isConfigured;
    }
}

export class SwitchComponent {
    constructor(id, pinA, pinB, isOpen = false) {
        this.id = id;
        this.type = 'SWITCH';
        this.pinA = pinA;
        this.pinB = pinB;
        this.isOpen = isOpen;
        this.rOn = 0.001;
        this.rOff = 1e8;
    }

    getConductance() {
        return 1.0 / (this.isOpen ? this.rOff : this.rOn);
    }

    toggle() {
        this.isOpen = !this.isOpen;
        return this.isOpen;
    }
}

export class LEDComponent {
    constructor(id, pinA, pinB, vForward = 2.0) {
        this.id = id;
        this.type = 'LED';
        this.pinA = pinA;
        this.pinB = pinB;
        this.vForward = vForward;
        this.isOn = false;
    }

    getConductance(vAnode, vCathode) {
        const vDiff = vAnode - vCathode;
        if (vDiff >= this.vForward) {
            this.isOn = true;
            return 1.0 / 10.0;
        } else {
            this.isOn = false;
            return 1.0 / 1e8;
        }
    }
}

export class Wire {
    constructor(id, pinA, pinB, color = '#0984e3') {
        this.id = id;
        this.type = 'WIRE';
        this.pinA = pinA;
        this.pinB = pinB;
        this.color = color;
        this.resistance = 0.0001;
    }

    getConductance() {
        return 1.0 / this.resistance;
    }
}
