/**
 * CircuitNode.js
 * Breadboard Tie-Point Pin to Electrical MNA Node Mapping Engine.
 * Supports Wanjie BB-4T7D 3,220 Tie-Points + Va, Vb, Vc, GND Power Supply Binding Posts.
 */

export class BreadboardGrid {
    constructor() {
        this.nodeMap = new Map();
        this.initNodeMap();
    }

    initNodeMap() {
        // 1. Top Power Bus Rails
        for (let i = 1; i <= 60; i++) {
            this.nodeMap.set(`VCC_TOP1_${i}`, 'NODE_RAIL_VCC_TOP1');
            this.nodeMap.set(`GND_TOP1_${i}`, '0'); // Ground
            this.nodeMap.set(`VCC_TOP_${i}`, 'NODE_RAIL_VCC_TOP1');
            this.nodeMap.set(`GND_TOP_${i}`, '0');
            this.nodeMap.set(`VCC_TOP2_${i}`, 'NODE_RAIL_VCC_TOP2');
            this.nodeMap.set(`GND_TOP2_${i}`, '0');
        }

        // 2. Power Supply Binding Posts (Va, Vb, Vc, GND)
        this.nodeMap.set('BINDING_Va', 'NODE_BINDING_VA');
        this.nodeMap.set('BINDING_Vb', 'NODE_BINDING_VB');
        this.nodeMap.set('BINDING_Vc', 'NODE_BINDING_VC');
        this.nodeMap.set('BINDING_GND', '0'); // Ground

        // 3. 4 Vertical Terminal Strip Blocks (Block 1~4)
        const leftCols = ['A', 'B', 'C', 'D', 'E'];
        const rightCols = ['F', 'G', 'H', 'I', 'J'];

        for (let blk = 1; blk <= 4; blk++) {
            for (let r = 1; r <= 63; r++) {
                // Vertical Rail Strip
                this.nodeMap.set(`B${blk}_VCC_${r}`, `NODE_B${blk}_RAIL_VCC`);
                this.nodeMap.set(`B${blk}_GND_${r}`, '0');

                // Left Row (Cols A, B, C, D, E)
                const leftNodeId = `NODE_B${blk}_L_ROW_${r}`;
                leftCols.forEach(col => {
                    this.nodeMap.set(`B${blk}_${col}${r}`, leftNodeId);
                    if (blk === 1) this.nodeMap.set(`${col}${r}`, leftNodeId);
                });

                // Right Row (Cols F, G, H, I, J)
                const rightNodeId = `NODE_B${blk}_R_ROW_${r}`;
                rightCols.forEach(col => {
                    this.nodeMap.set(`B${blk}_${col}${r}`, rightNodeId);
                    if (blk === 1) this.nodeMap.set(`${col}${r}`, rightNodeId);
                });
            }
        }
    }

    getNodeId(pinKey) {
        if (!pinKey) return null;
        if (pinKey === 'GND' || pinKey.startsWith('GND_') || pinKey === 'BINDING_GND') {
            return '0';
        }
        return this.nodeMap.get(pinKey) || `NODE_${pinKey}`;
    }
}
