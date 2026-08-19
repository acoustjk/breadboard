/**
 * CircuitNode.js
 * Wanjie BB-4T7D 3220-Pin Breadboard Grid.
 * Power rails are ISOLATED by default so users connect top & vertical rails using Jumper Wires.
 */

export class BreadboardGrid {
    constructor() {
        this.numBlocks = 4;
        this.rowsPerBlock = 63;
        this.totalPins = 3220;

        this.pinToNodeMap = new Map();
        this.initNodeMap();
    }

    initNodeMap() {
        // 1. Top 4 Horizontal Power Bus Lines (Isolated Node IDs)
        for (let i = 1; i <= 60; i++) {
            this.pinToNodeMap.set(`VCC_TOP1_${i}`, 'RAIL_VCC_TOP1');
            this.pinToNodeMap.set(`GND_TOP1_${i}`, 'GND');
            this.pinToNodeMap.set(`VCC_TOP2_${i}`, 'RAIL_VCC_TOP2');
            this.pinToNodeMap.set(`GND_TOP2_${i}`, 'GND');

            // Legacy fallbacks
            this.pinToNodeMap.set(`VCC_TOP_${i}`, 'RAIL_VCC_TOP1');
            this.pinToNodeMap.set(`GND_TOP_${i}`, 'GND');
        }

        // 2. 4 Vertical Terminal Blocks (Each block's vertical power rails are ISOLATED by default)
        const leftCols = ['A', 'B', 'C', 'D', 'E'];
        const rightCols = ['F', 'G', 'H', 'I', 'J'];

        for (let blk = 1; blk <= 4; blk++) {
            const vccNodeId = `NODE_B${blk}_RAIL_VCC`;
            const gndNodeId = `NODE_B${blk}_RAIL_GND`;

            for (let row = 1; row <= this.rowsPerBlock; row++) {
                this.pinToNodeMap.set(`B${blk}_VCC_${row}`, vccNodeId);
                this.pinToNodeMap.set(`B${blk}_GND_${row}`, gndNodeId);
            }

            for (let row = 1; row <= this.rowsPerBlock; row++) {
                const leftNodeId = `NODE_B${blk}_L_ROW_${row}`;
                const rightNodeId = `NODE_B${blk}_R_ROW_${row}`;

                leftCols.forEach(col => {
                    this.pinToNodeMap.set(`B${blk}_${col}${row}`, leftNodeId);
                    if (blk === 1) {
                        this.pinToNodeMap.set(`${col}${row}`, leftNodeId);
                    }
                });

                rightCols.forEach(col => {
                    this.pinToNodeMap.set(`B${blk}_${col}${row}`, rightNodeId);
                    if (blk === 1) {
                        this.pinToNodeMap.set(`${col}${row}`, rightNodeId);
                    }
                });
            }
        }
    }

    getNodeId(pinKey) {
        if (!pinKey) return 'GND';
        if (pinKey === 'GND' || pinKey.startsWith('GND_TOP')) return 'GND';
        return this.pinToNodeMap.get(pinKey) || pinKey;
    }
}
