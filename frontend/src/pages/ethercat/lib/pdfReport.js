/**
 * Black-box fault report (PDF). jsPDF is bundled and loaded only when a
 * report is exported — the old page pulled it from a CDN on every load,
 * which fails on an offline shop-floor PC.
 *
 * Note: jsPDF's built-in Helvetica has no ✓ / ⚠ glyphs (they printed as
 * garbage before), so the report uses plain text markers.
 */
import { SLOT_REGISTERS, formatRegister, codeHex } from './faults';
import { jointLabel } from './format';

export async function generateFaultReport({ results, masterId, numSlots = 9 }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const PW = 210, PH = 297, ML = 16, MR = 16, CW = PW - ML - MR;
  const now = new Date();
  const reportTs = now.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'medium' });
  const C = {
    navy: [11, 31, 77], navyLt: [232, 238, 252], accent: [29, 78, 216],
    red: [192, 38, 45], redLt: [253, 236, 235], green: [15, 123, 79], greenLt: [232, 246, 239],
    amber: [180, 83, 9], amberLt: [253, 243, 226],
    gray1: [248, 249, 250], gray2: [228, 231, 236], gray3: [138, 148, 166], black: [17, 24, 39], white: [255, 255, 255],
  };
  let y = 0;
  const font = (sz, wt = 'normal', col = C.black) => { doc.setFontSize(sz); doc.setFont('helvetica', wt); doc.setTextColor(...col); };
  const fill = (c) => doc.setFillColor(...c);
  const draw = (c) => doc.setDrawColor(...c);
  const lw = (w) => doc.setLineWidth(w);
  const rect = (x, yy, w, h, s = 'F') => doc.rect(x, yy, w, h, s);

  const pageHeader = () => {
    fill(C.navy); rect(0, 0, PW, 11);
    font(7, 'bold', C.white);
    doc.text('EtherCAT Fault Diagnosis Report', ML, 7);
    doc.text(reportTs, PW - MR, 7, { align: 'right' });
  };
  const checkBreak = (needed = 20) => {
    if (y + needed > PH - 14) { doc.addPage(); pageHeader(); y = 18; }
  };
  const section = (title) => {
    checkBreak(12);
    fill(C.navy); rect(ML, y, CW, 7.5);
    font(9, 'bold', C.white);
    doc.text(title.toUpperCase(), ML + 4, y + 5.2);
    y += 10;
  };

  // ── Aggregate ──
  let totalFaults = 0, driversWithFault = 0;
  const index = [];
  for (const d of results) {
    let had = false;
    for (const s of d.slots) {
      if (s.faultCode) {
        totalFaults++; had = true;
        index.push({ driver: d.driver, slot: s.slot, code: codeHex(s.faultCode), name: s.faultDetails?.name || 'Unknown', type: s.faultDetails?.type || '-', resettable: s.faultDetails?.resettable || '-' });
      }
    }
    if (had) driversWithFault++;
  }

  // ── Cover ──
  fill(C.navy); rect(0, 0, PW, 58);
  fill(C.accent); rect(0, 54, PW, 4);
  font(24, 'bold', C.white); doc.text('Fault Diagnosis Report', ML, 28);
  font(10, 'normal', [175, 200, 240]); doc.text('EtherCAT drive system  -  automated fault-log analysis', ML, 37);
  font(8, 'normal', [150, 180, 225]);
  doc.text(`Generated: ${reportTs}`, ML, 45);
  doc.text(`${results.length} drives  -  last ${numSlots} faults each`, ML, 50);
  y = 68;

  const boxes = [
    { label: 'Drives analysed', value: results.length, bg: C.navy },
    { label: 'Faults found', value: totalFaults, bg: totalFaults ? C.red : C.green },
    { label: 'Drives with faults', value: driversWithFault, bg: driversWithFault ? C.red : C.green },
    { label: 'Records per drive', value: numSlots, bg: [52, 64, 84] },
  ];
  const bw = (CW - 9) / 4;
  boxes.forEach((b, i) => {
    const bx = ML + i * (bw + 3);
    fill(b.bg); rect(bx, y, bw, 22);
    font(18, 'bold', C.white); doc.text(String(b.value), bx + bw / 2, y + 12.5, { align: 'center' });
    font(6.5, 'normal', [220, 228, 240]); doc.text(b.label.toUpperCase(), bx + bw / 2, y + 18.5, { align: 'center' });
  });
  y += 30;

  section('Fault index');
  const col = { d: ML + 3, s: ML + 22, c: ML + 36, n: ML + 64, t: ML + 146, r: ML + 162 };
  fill(C.navyLt); draw(C.gray2); lw(0.2); rect(ML, y, CW, 8, 'FD');
  font(7.5, 'bold', C.navy);
  doc.text('Drive', col.d, y + 5.5); doc.text('Record', col.s, y + 5.5); doc.text('Code', col.c, y + 5.5);
  doc.text('Fault name', col.n, y + 5.5); doc.text('Type', col.t, y + 5.5); doc.text('Resettable', col.r, y + 5.5);
  y += 8;
  if (!index.length) {
    fill(C.greenLt); rect(ML, y, CW, 10);
    font(9, 'bold', C.green); doc.text('No faults recorded on any drive.', ML + CW / 2, y + 6.5, { align: 'center' });
    y += 14;
  } else {
    index.forEach((f, i) => {
      checkBreak(8);
      fill(i % 2 ? C.gray1 : C.white); draw(C.gray2); lw(0.1); rect(ML, y, CW, 7.5, 'FD');
      font(8, 'normal'); doc.text(jointLabel(f.driver), col.d, y + 5.2); doc.text(String(f.slot), col.s, y + 5.2);
      font(7.5, 'bold', C.red); doc.text(f.code, col.c, y + 5.2);
      font(7.5, 'normal'); doc.text(f.name.length > 40 ? `${f.name.slice(0, 39)}...` : f.name, col.n, y + 5.2);
      font(7.5, 'bold', f.type === 'No.1' ? C.red : f.type === 'No.2' ? C.amber : C.green); doc.text(f.type, col.t, y + 5.2);
      font(7.5, 'normal', f.resettable === 'Yes' ? C.green : C.red); doc.text(f.resettable, col.r, y + 5.2);
      y += 7.5;
    });
    y += 4;
  }

  checkBreak(36);
  section('Drive health overview');
  const n = Math.max(results.length, 1);
  const dw = (CW - (n - 1) * 3) / n;
  results.forEach((d, i) => {
    const bx = ML + i * (dw + 3);
    const faults = d.slots.filter((s) => s.faultCode).length;
    const err = d.slots.some((s) => s.error);
    const [bg, tc] = err ? [C.amberLt, C.amber] : faults ? [C.redLt, C.red] : [C.greenLt, C.green];
    fill(bg); draw(tc); lw(0.4); rect(bx, y, dw, 20, 'FD');
    font(7, 'bold', tc); doc.text(jointLabel(d.driver), bx + dw / 2, y + 6.5, { align: 'center' });
    font(13, 'bold', tc); doc.text(err && !faults ? '!' : String(faults), bx + dw / 2, y + 15, { align: 'center' });
  });
  y += 25;
  font(7, 'normal', C.gray3); doc.text('Number = faults recorded in the log.  ! = communication error while reading.', ML, y);

  // ── One page per drive ──
  for (const d of results) {
    doc.addPage(); pageHeader(); y = 18;
    const faultSlots = d.slots.filter((s) => s.faultCode);
    fill(faultSlots.length ? C.red : C.green); rect(ML, y, CW, 12);
    font(12, 'bold', C.white); doc.text(`Drive ${jointLabel(d.driver)}  (position ${d.driver})`, ML + 4, y + 8);
    font(8, 'normal', C.white);
    doc.text(faultSlots.length ? `${faultSlots.length} fault(s) in ${numSlots} records` : `No faults in ${numSlots} records`, PW - MR - 4, y + 8, { align: 'right' });
    y += 17;

    const sw = (CW - (numSlots - 1) * 2.5) / numSlots;
    d.slots.forEach((s, i) => {
      const sx = ML + i * (sw + 2.5);
      const [bg, tc, label] = s.error ? [C.amberLt, C.amber, 'ERR'] : s.faultCode ? [C.redLt, C.red, 'FAULT'] : [C.greenLt, C.green, 'EMPTY'];
      fill(bg); draw(tc); lw(0.3); rect(sx, y, sw, 11, 'FD');
      font(7, 'bold', tc); doc.text(`S${s.slot}`, sx + sw / 2, y + 4.6, { align: 'center' });
      font(5.5, 'normal', tc); doc.text(label, sx + sw / 2, y + 9, { align: 'center' });
    });
    y += 16;

    for (const s of d.slots) {
      checkBreak(26);
      const [bg, tc] = s.error ? [C.amberLt, C.amber] : s.faultCode ? [C.redLt, C.red] : [C.gray1, C.gray3];
      fill(bg); draw(s.faultCode || s.error ? tc : C.gray2); lw(0.3); rect(ML, y, CW, 7.5, 'FD');
      font(8, 'bold', tc); doc.text(`Record ${s.slot}`, ML + 4, y + 5.2);
      font(8, 'normal', tc);
      const label = s.error ? `Read error: ${String(s.error).slice(0, 80)}`
        : s.faultCode ? `${codeHex(s.faultCode)}${s.faultDetails ? `  -  ${s.faultDetails.subFaultCode} ${s.faultDetails.name}` : '  -  not in fault database'}`
          : 'Empty - no fault recorded';
      doc.text(label, ML + 22, y + 5.2);
      y += 9.5;
      if (s.error || !s.faultCode) { y += 1.5; continue; }

      checkBreak(15);
      const rw = CW / SLOT_REGISTERS.length;
      SLOT_REGISTERS.forEach((reg, ri) => {
        const rx = ML + ri * rw;
        fill(C.gray1); draw(C.gray2); lw(0.2); rect(rx, y, rw - 1, 12, 'FD');
        font(6, 'normal', C.gray3); doc.text(reg.short, rx + (rw - 1) / 2, y + 4.2, { align: 'center' });
        font(7.5, 'bold', reg.sub === '0x23' ? C.red : C.black);
        doc.text(formatRegister(reg, s.registers?.[reg.sub]), rx + (rw - 1) / 2, y + 9.6, { align: 'center' });
      });
      y += 15;

      const sf = s.faultDetails;
      if (!sf) continue;
      checkBreak(18);
      const top = y;
      font(6.5, 'normal', C.gray3);
      doc.text(`603Fh ${sf.errorCode603Fh || '-'}    203Fh ${sf.auxiliaryCode203Fh || '-'}    ${sf.faultRange || ''}    Type ${sf.type || '-'}    ${sf.resettable === 'Yes' ? 'Resettable' : 'Not resettable'}`, ML + 4, y + 4.5);
      y += 7;
      (sf.causesAndSolutions || []).forEach((cs, ci) => {
        const causeLines = doc.splitTextToSize(cs.cause || '', CW - 12);
        const confLines = cs.confirmingMethod ? doc.splitTextToSize(cs.confirmingMethod, CW - 12) : [];
        const solLines = doc.splitTextToSize(cs.solution || '', CW - 12);
        checkBreak(10 + (causeLines.length + confLines.length + solLines.length) * 3.8);
        font(6, 'bold', C.gray3); doc.text(`CAUSE ${ci + 1}`, ML + 4, y + 3);
        font(7.5, 'normal', C.black); doc.text(causeLines, ML + 4, y + 7); y += 5 + causeLines.length * 3.8;
        if (confLines.length) { font(7, 'italic', C.gray3); doc.text(confLines, ML + 4, y + 2.5); y += confLines.length * 3.6 + 1; }
        font(7.5, 'normal', C.accent); doc.text(solLines, ML + 4, y + 2.5); y += solLines.length * 3.8 + 3;
      });
      draw(C.red); lw(0.3); doc.line(ML, top, ML, y);
      y += 4;
    }
  }

  const pages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    fill(C.gray1); rect(0, PH - 9, PW, 9);
    font(6.5, 'normal', C.gray3);
    doc.text('EtherCAT Fault Diagnosis Report - auto-generated', ML, PH - 3.5);
    doc.text(`${p} / ${pages}`, PW - MR, PH - 3.5, { align: 'right' });
  }

  const fname = `fault-report-M${masterId}-${now.toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}.pdf`;
  doc.save(fname);
  return { fname, pages, totalFaults };
}
