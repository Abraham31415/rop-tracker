/**
 * PDF export service using jsPDF + autoTable + qrcode.
 * Three entry points:
 *   generatePopulationPDF(reportData, user)     — Type 1 population report
 *   generateBabyFullPDF(baby, exams, hospital)  — Type 2 full baby summary
 *   generateSingleVisitPDF(baby, exam, hospital)— Type 2 single visit
 */
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import QRCode from 'qrcode'

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  teal:      [13, 148, 136],
  tealDark:  [15, 118, 110],
  tealLight: [204, 251, 241],
  tealText:  [17, 94, 89],
  white:     [255, 255, 255],
  gray900:   [17, 24, 39],
  gray700:   [55, 65, 81],
  gray500:   [107, 114, 128],
  gray200:   [229, 231, 235],
  gray100:   [243, 244, 246],
  red:       [220, 38, 38],
  amber:     [217, 119, 6],
  green:     [22, 163, 74],
}

// ── Page geometry ─────────────────────────────────────────────────────────────
const PW = 210   // A4 width mm
const PH = 297   // A4 height mm
const ML = 18    // left margin
const MR = 18    // right margin
const CW = PW - ML - MR  // content width

// ── Label maps ────────────────────────────────────────────────────────────────
const ZONE_LABELS  = { zone_i: 'Zone I', zone_ii: 'Zone II', zone_iii: 'Zone III' }
const STAGE_LABELS = { no_rop: 'No ROP', stage_1: 'Stage 1', stage_2: 'Stage 2', stage_3: 'Stage 3', stage_4: 'Stage 4', stage_5: 'Stage 5', immature: 'Immature' }
const PLUS_LABELS  = { none: 'None', pre_plus: 'Pre-Plus', plus: 'Plus Disease' }
const ROLE_LABELS  = { nicu_nurse: 'NICU Nurse', ophthalmologist: 'Ophthalmologist', hospital_coordinator: 'Hospital Coordinator', central_coordinator: 'Central Coordinator' }
const TREATMENT_LABELS = { laser: 'Laser Photocoagulation', bevacizumab: 'Intravitreal Bevacizumab (IVB)', laser_and_bevacizumab: 'Laser + Bevacizumab', surgery: 'Vitreoretinal Surgery' }
const VF_FIXATION_LABELS   = { central: 'Central', eccentric: 'Eccentric', none_unable: 'None / Unable' }
const VF_FOLLOWING_LABELS  = { follows_smoothly: 'Follows smoothly', follows_partially: 'Follows partially', does_not_follow: 'Does not follow', unable_to_assess: 'Unable to assess' }
const VF_CSM_LABELS        = { csm: 'CSM', cs: 'CS (not maintained)', c: 'C (not steady)', not_central: 'Not central (N)', unable_to_assess: 'Unable to assess' }
const VF_NYSTAGMUS_LABELS  = { absent: 'Absent', pendular: 'Present (Pendular)', jerk: 'Present (Jerk)', latent: 'Present (Latent)' }
const VF_STRABISMUS_LABELS = { absent: 'Absent', esotropia: 'Esotropia', exotropia: 'Exotropia', suspected: 'Suspected (orthoptic review needed)' }
const VF_IMPRESSION_LABELS = { age_appropriate: 'Age-appropriate visual function', mildly_delayed: 'Mildly delayed (monitor)', significantly_delayed: 'Significantly delayed (refer for low vision)', unable_to_assess: 'Unable to assess this visit' }

function hasVFData(exam) {
  return !!(exam.vf_right_fixation || exam.vf_left_fixation || exam.vf_right_following ||
    exam.vf_left_following || exam.vf_nystagmus || exam.vf_strabismus || exam.vf_functional_impression)
}

function addVFSection(doc, exam, yStart) {
  let y = yStart
  y = sectionHeading(doc, y, 'Visual Function Assessment')

  const rows = []
  if (exam.vf_right_fixation || exam.vf_left_fixation)
    rows.push(['Fixation', VF_FIXATION_LABELS[exam.vf_right_fixation] || '-', VF_FIXATION_LABELS[exam.vf_left_fixation] || '-'])
  if (exam.vf_right_following || exam.vf_left_following)
    rows.push(['Following', VF_FOLLOWING_LABELS[exam.vf_right_following] || '-', VF_FOLLOWING_LABELS[exam.vf_left_following] || '-'])
  if (exam.vf_right_csm || exam.vf_left_csm)
    rows.push(['CSM', VF_CSM_LABELS[exam.vf_right_csm] || '-', VF_CSM_LABELS[exam.vf_left_csm] || '-'])
  if (exam.vf_right_teller_acuity != null || exam.vf_left_teller_acuity != null)
    rows.push(['Teller Acuity (c/d)', exam.vf_right_teller_acuity != null ? String(exam.vf_right_teller_acuity) : '-', exam.vf_left_teller_acuity != null ? String(exam.vf_left_teller_acuity) : '-'])
  if (exam.vf_right_vep != null || exam.vf_left_vep != null)
    rows.push(['VEP (LogMAR)', exam.vf_right_vep != null ? String(exam.vf_right_vep) : '-', exam.vf_left_vep != null ? String(exam.vf_left_vep) : '-'])

  if (rows.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [['Finding', 'Right Eye (OD)', 'Left Eye (OS)']],
      body: rows,
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      headStyles: { fillColor: [204, 251, 241], textColor: [17, 94, 89], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.gray100 },
      columnStyles: { 0: { fontStyle: 'bold', textColor: C.gray500, cellWidth: 45 } },
    })
    y = doc.lastAutoTable.finalY + 4
  }

  const binocular = []
  if (exam.vf_nystagmus)  binocular.push(['Nystagmus', VF_NYSTAGMUS_LABELS[exam.vf_nystagmus]])
  if (exam.vf_strabismus) binocular.push(['Strabismus', VF_STRABISMUS_LABELS[exam.vf_strabismus]])
  if (exam.vf_functional_impression) binocular.push(['Overall Impression', VF_IMPRESSION_LABELS[exam.vf_functional_impression]])

  if (binocular.length > 0) {
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      body: binocular,
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: C.gray100 },
      columnStyles: { 0: { fontStyle: 'bold', textColor: C.gray500, cellWidth: 55 } },
    })
    y = doc.lastAutoTable.finalY + 4
  }

  if (exam.vf_notes) {
    setTxt(doc, C.gray700)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    const lines = doc.splitTextToSize(exam.vf_notes, CW - 6)
    doc.text(lines, ML + 3, y)
    y += lines.length * 4.5 + 4
  }

  return y
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '-'
  const dt = new Date(d + (d.includes('T') ? '' : 'T00:00:00'))
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtNow() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function eyeStr(zone, stage, plus) {
  if (!zone) return '-'
  const parts = [ZONE_LABELS[zone] || zone]
  if (stage) parts.push(STAGE_LABELS[stage] || stage)
  if (plus && plus !== 'none') parts.push(PLUS_LABELS[plus] || plus)
  return parts.join(' · ')
}

function setFill(doc, rgb) { doc.setFillColor(...rgb) }
function setDraw(doc, rgb) { doc.setDrawColor(...rgb) }
function setTxt(doc, rgb)  { doc.setTextColor(...rgb) }

async function qrDataUrl(url) {
  try {
    return await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#0f766e', light: '#ffffff' } })
  } catch { return null }
}

// ── Footer ─────────────────────────────────────────────────────────────────────
function addFooter(doc, pageNum, totalPages) {
  const y = PH - 9
  setFill(doc, C.teal)
  doc.rect(0, y - 3, PW, 12, 'F')
  setTxt(doc, C.white)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.text('ROP Tracker Uganda', ML, y + 2)
  doc.text('CONFIDENTIAL: For clinical use only', PW / 2, y + 2, { align: 'center' })
  doc.text(`Page ${pageNum} of ${totalPages}`, PW - MR, y + 2, { align: 'right' })
}

// ── Teal section heading ──────────────────────────────────────────────────────
function sectionHeading(doc, y, title) {
  setFill(doc, C.tealLight)
  doc.rect(ML, y, CW, 7, 'F')
  setTxt(doc, C.tealText)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(title.toUpperCase(), ML + 3, y + 4.5)
  return y + 10
}

// ── Key-value rows ────────────────────────────────────────────────────────────
function kvRow(doc, y, label, value, col = 0) {
  const colW = CW / 2
  const x = ML + col * colW
  setTxt(doc, C.gray500)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(label, x, y)
  setTxt(doc, C.gray900)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(String(value || '-'), x + colW * 0.45, y)
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE 1 — Population / Program Report
// ─────────────────────────────────────────────────────────────────────────────
export async function generatePopulationPDF(report) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const { summary, stage_breakdown, ga_breakdown, hospital_breakdown, ltfu_analysis, monthly_trend, hospital_name, generated_by, filters } = report

  const periodStr = filters.start_date && filters.end_date
    ? `${fmtDate(filters.start_date)} to ${fmtDate(filters.end_date)}`
    : filters.start_date ? `From ${fmtDate(filters.start_date)}`
    : filters.end_date   ? `To ${fmtDate(filters.end_date)}`
    : 'All Time'

  // ── COVER PAGE ──────────────────────────────────────────────────────────────
  // Full teal header band
  setFill(doc, C.teal)
  doc.rect(0, 0, PW, 70, 'F')

  // Eye icon (nested circles in teal shades)
  setFill(doc, [10, 120, 110])
  doc.circle(PW / 2, 28, 18, 'F')
  setFill(doc, C.tealDark)
  doc.circle(PW / 2, 28, 8, 'F')
  setFill(doc, C.white)
  doc.circle(PW / 2, 28, 4, 'F')

  // Title text
  setTxt(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.text('ROP Tracker Uganda', PW / 2, 55, { align: 'center' })
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text('Retinopathy of Prematurity Follow-up Network', PW / 2, 62, { align: 'center' })

  // Report type badge
  setFill(doc, C.tealDark)
  doc.roundedRect(PW / 2 - 45, 73, 90, 10, 2, 2, 'F')
  setTxt(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('POPULATION & PROGRAM REPORT', PW / 2, 79.5, { align: 'center' })

  // Meta info box
  let y = 95
  setFill(doc, C.gray100)
  doc.roundedRect(ML, y, CW, 52, 3, 3, 'F')
  setDraw(doc, C.gray200)
  doc.setLineWidth(0.3)
  doc.roundedRect(ML, y, CW, 52, 3, 3, 'S')

  const metaRows = [
    ['Report Period', periodStr],
    ['Hospital / Scope', hospital_name],
    ['Date Generated', fmtNow()],
    ['Generated By', `${generated_by?.name || 'Unknown'} (${ROLE_LABELS[generated_by?.role] || generated_by?.role || 'Unknown'})`],
  ]
  y += 8
  for (const [label, value] of metaRows) {
    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(label + ':', ML + 6, y)
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(value, ML + 55, y)
    y += 10
  }

  // Key numbers grid on cover
  y = 160
  setTxt(doc, C.gray500)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('HEADLINE STATISTICS', PW / 2, y, { align: 'center' })
  y += 6

  const statItems = [
    { label: 'Babies Enrolled', value: summary.total_babies, color: C.teal },
    { label: 'Exams Performed', value: summary.total_exams, color: C.teal },
    { label: 'ROP Detected', value: `${summary.rop_detected} (${summary.rop_detected_pct}%)`, color: C.amber },
    { label: 'Treatment Required', value: summary.treatment_required, color: C.red },
    { label: 'Lost to Follow-Up', value: `${summary.ltfu_count} (${summary.ltfu_rate}%)`, color: C.red },
    { label: 'SMS Reminders Sent', value: summary.sms_sent, color: C.green },
  ]

  const boxW = (CW - 10) / 3
  const boxH = 24
  const cols3 = [ML, ML + boxW + 5, ML + (boxW + 5) * 2]

  for (let i = 0; i < statItems.length; i++) {
    const { label, value, color } = statItems[i]
    const col = i % 3
    const row = Math.floor(i / 3)
    const bx = cols3[col]
    const by = y + row * (boxH + 5)

    setFill(doc, C.white)
    doc.roundedRect(bx, by, boxW, boxH, 2, 2, 'F')
    setDraw(doc, C.gray200)
    doc.setLineWidth(0.3)
    doc.roundedRect(bx, by, boxW, boxH, 2, 2, 'S')

    // Top accent line
    setFill(doc, color)
    doc.rect(bx, by, boxW, 1.5, 'F')

    setTxt(doc, color)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(String(value), bx + boxW / 2, by + 14, { align: 'center' })

    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(label, bx + boxW / 2, by + 20, { align: 'center' })
  }

  // footer for cover page added in the final loop below

  // ── CONTENT PAGES ──────────────────────────────────────────────────────────
  doc.addPage()
  y = 16

  // Page header
  setFill(doc, C.teal)
  doc.rect(0, 0, PW, 11, 'F')
  setTxt(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('ROP Tracker Uganda  ·  Population & Program Report', ML, 7.5)
  doc.setFont('helvetica', 'normal')
  doc.text(hospital_name + '  ·  ' + periodStr, PW - MR, 7.5, { align: 'right' })

  // ── Stage breakdown ──
  y = sectionHeading(doc, y, 'Breakdown by ROP Stage (Latest Finding per Baby)')
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['ROP Stage / Finding', 'Babies', '% of Total']],
    body: stage_breakdown.map(s => [
      s.label,
      s.count,
      summary.total_babies > 0 ? `${Math.round(s.count / summary.total_babies * 100)}%` : '-',
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: C.gray100 },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── GA band breakdown ──
  y = sectionHeading(doc, y, 'Breakdown by Gestational Age at Birth')
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Gestational Age Band', 'Babies', '% of Total']],
    body: ga_breakdown.map(g => [
      g.band,
      g.count,
      summary.total_babies > 0 ? `${Math.round(g.count / summary.total_babies * 100)}%` : '-',
    ]),
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: C.gray100 },
    columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── LTFU analysis ──
  y = sectionHeading(doc, y, 'LTFU Analysis: Missed Appointments')
  autoTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Missed Appointments', 'Babies (LTFU)']],
    body: [
      ['Missed 1 appointment', ltfu_analysis.missed_1],
      ['Missed 2 appointments', ltfu_analysis.missed_2],
      ['Missed 3 or more appointments', ltfu_analysis.missed_3plus],
      ['Total LTFU', summary.ltfu_count],
    ],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: C.gray100 },
    columnStyles: { 1: { halign: 'center' } },
    bodyStyles: {},
    didParseCell: (data) => {
      if (data.row.index === 3) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = C.tealLight
        data.cell.styles.textColor = C.tealText
      }
    },
  })
  y = doc.lastAutoTable.finalY + 8

  // New page for hospital breakdown and monthly trend
  if (hospital_breakdown.length > 0) {
    if (y > 200) { doc.addPage(); addPageHeader(doc, hospital_name, periodStr); y = 20 }
    y = sectionHeading(doc, y, 'Breakdown by Hospital')
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [['Hospital', 'District', 'Enrolled', 'Active', 'LTFU', 'LTFU Rate', 'Exams']],
      body: hospital_breakdown.map(h => [h.hospital_name, h.district, h.total, h.active, h.ltfu, `${h.ltfu_rate}%`, h.exams]),
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.gray100 },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' }, 6: { halign: 'center' } },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Monthly trend
  if (monthly_trend.length > 0) {
    if (y > 220) { doc.addPage(); addPageHeader(doc, hospital_name, periodStr); y = 20 }
    y = sectionHeading(doc, y, 'Monthly Trend: Enrollments and Exams')
    autoTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [['Month', 'Enrollments', 'Exams Performed']],
      body: monthly_trend.map(m => [m.label, m.enrolled, m.exams]),
      foot: [['TOTAL', monthly_trend.reduce((s, m) => s + m.enrolled, 0), monthly_trend.reduce((s, m) => s + m.exams, 0)]],
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: C.teal, textColor: C.white, fontStyle: 'bold' },
      footStyles: { fillColor: C.tealLight, textColor: C.tealText, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: C.gray100 },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
    })
  }

  // Fix page numbers
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    addFooter(doc, p, totalPages)
  }

  doc.save(`ROP-Population-Report-${Date.now()}.pdf`)
}

function addPageHeader(doc, hospitalName, period) {
  setFill(doc, C.teal)
  doc.rect(0, 0, PW, 11, 'F')
  setTxt(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('ROP Tracker Uganda  ·  Population & Program Report', ML, 7.5)
  doc.setFont('helvetica', 'normal')
  doc.text(hospitalName + '  ·  ' + period, PW - MR, 7.5, { align: 'right' })
}

// ─────────────────────────────────────────────────────────────────────────────
// B&W HELPERS  (Type 2A and 2B only — population PDF keeps its coloured helpers)
// ─────────────────────────────────────────────────────────────────────────────
const BW = {
  black:  [0, 0, 0],
  white:  [255, 255, 255],
  gray:   [245, 245, 245],   // F5F5F5 alternating row fill
  border: [180, 180, 180],   // thin rule / cell border
  label:  [100, 100, 100],   // secondary / label text
}

const STATUS_LABELS_BW = {
  active:     '[ACTIVE]',
  ltfu:       '[LOST TO FOLLOW-UP]',
  discharged: '[DISCHARGED]',
  treated:    '[TREATED]',
}

async function qrDataUrlBW(url) {
  try {
    return await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
  } catch { return null }
}

function bwFooter(doc, pageNum, totalPages) {
  const lineY = PH - 15   // rule at 282 mm
  const textY = PH - 7    // baseline at 290 mm
  setDraw(doc, BW.border)
  doc.setLineWidth(0.3)
  doc.line(ML, lineY, PW - MR, lineY)
  setTxt(doc, BW.label)
  doc.setFont('times', 'normal')
  doc.setFontSize(12)
  doc.text('ROP Tracker Uganda', ML, textY)
  doc.text('CONFIDENTIAL: For clinical use only', PW / 2, textY, { align: 'center' })
  doc.text(`Page ${pageNum} of ${totalPages}`, PW - MR, textY, { align: 'right' })
}

// Bold Times uppercase heading + thin black underline; returns y after heading
function bwSectionHeading(doc, y, title) {
  setTxt(doc, BW.black)
  doc.setFont('times', 'bold')
  doc.setFontSize(12)
  doc.text(title.toUpperCase(), ML, y + 5)
  setDraw(doc, BW.black)
  doc.setLineWidth(0.4)
  doc.line(ML, y + 8, ML + CW, y + 8)
  return y + 15
}

// autoTable wrapper: Times 12pt body AND head, black borders, F5F5F5 alt rows
function bwTable(doc, opts) {
  autoTable(doc, {
    ...opts,
    styles: {
      font: 'times',
      fontSize: 12,
      textColor: BW.black,
      cellPadding: 2.5,
      lineColor: BW.border,
      lineWidth: 0.3,
      ...(opts.styles || {}),
    },
    headStyles: {
      fillColor: BW.white,
      textColor: BW.black,
      fontStyle: 'bold',
      font: 'times',
      lineColor: BW.black,
      lineWidth: 0.4,
      ...(opts.headStyles || {}),
    },
    alternateRowStyles: {
      fillColor: BW.gray,
      ...(opts.alternateRowStyles || {}),
    },
    bodyStyles: {
      fillColor: BW.white,
      ...(opts.bodyStyles || {}),
    },
  })
}

function addVFSectionBW(doc, exam, yStart) {
  let y = yStart
  y = bwSectionHeading(doc, y, 'Visual Function Assessment')

  const rows = []
  if (exam.vf_right_fixation || exam.vf_left_fixation)
    rows.push(['Fixation', VF_FIXATION_LABELS[exam.vf_right_fixation] || '-', VF_FIXATION_LABELS[exam.vf_left_fixation] || '-'])
  if (exam.vf_right_following || exam.vf_left_following)
    rows.push(['Following', VF_FOLLOWING_LABELS[exam.vf_right_following] || '-', VF_FOLLOWING_LABELS[exam.vf_left_following] || '-'])
  if (exam.vf_right_csm || exam.vf_left_csm)
    rows.push(['CSM', VF_CSM_LABELS[exam.vf_right_csm] || '-', VF_CSM_LABELS[exam.vf_left_csm] || '-'])
  if (exam.vf_right_teller_acuity != null || exam.vf_left_teller_acuity != null)
    rows.push(['Teller Acuity (c/d)',
      exam.vf_right_teller_acuity != null ? String(exam.vf_right_teller_acuity) : '-',
      exam.vf_left_teller_acuity  != null ? String(exam.vf_left_teller_acuity)  : '-'])
  if (exam.vf_right_vep != null || exam.vf_left_vep != null)
    rows.push(['VEP (LogMAR)',
      exam.vf_right_vep != null ? String(exam.vf_right_vep) : '-',
      exam.vf_left_vep  != null ? String(exam.vf_left_vep)  : '-'])

  if (rows.length > 0) {
    bwTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [['Finding', 'Right Eye (OD)', 'Left Eye (OS)']],
      body: rows,
      styles: { fontSize: 12, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 45 } },
    })
    y = doc.lastAutoTable.finalY + 4
  }

  const binocular = []
  if (exam.vf_nystagmus)             binocular.push(['Nystagmus',         VF_NYSTAGMUS_LABELS[exam.vf_nystagmus]])
  if (exam.vf_strabismus)            binocular.push(['Strabismus',        VF_STRABISMUS_LABELS[exam.vf_strabismus]])
  if (exam.vf_functional_impression) binocular.push(['Overall Impression', VF_IMPRESSION_LABELS[exam.vf_functional_impression]])

  if (binocular.length > 0) {
    bwTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      body: binocular,
      styles: { fontSize: 12, cellPadding: 2.5 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } },
    })
    y = doc.lastAutoTable.finalY + 4
  }

  if (exam.vf_notes) {
    setTxt(doc, BW.black)
    doc.setFont('times', 'italic')
    doc.setFontSize(12)
    const lines = doc.splitTextToSize(exam.vf_notes, CW - 6)
    doc.text(lines, ML + 3, y)
    y += lines.length * 6 + 4
  }

  return y
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE 2A — Single Visit Report  (black & white)
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSingleVisitPDF(baby, exam, hospitalName) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const babyUrl = `https://rop-tracker.vercel.app/babies/${baby.id}`
  const qr = await qrDataUrlBW(babyUrl)

  // ── Header: text left, QR right ───────────────────────────────────────────
  // QR: top=5, size=24 → bottom=29; caption baseline=37; rop_id=44; divider=51
  const QR_SIZE = 24
  const QR_TOP  = 5
  const qrX = PW - MR - QR_SIZE

  // Left text — all Times 12pt, 7 mm line spacing
  setTxt(doc, BW.black)
  doc.setFont('times', 'bold')
  doc.setFontSize(12)
  doc.text('ROP SCREENING RECORD', ML, 13)

  setTxt(doc, BW.label)
  doc.setFont('times', 'normal')
  doc.setFontSize(12)
  doc.text('Retinopathy of Prematurity Follow-Up Network', ML, 20)
  doc.text(hospitalName || 'Uganda ROP Network', ML, 27)
  doc.text(`Generated: ${fmtNow()}`, ML, 34)

  // QR + caption — all above divider
  if (qr) {
    doc.addImage(qr, 'PNG', qrX, QR_TOP, QR_SIZE, QR_SIZE)
    // 4 mm visual gap below QR image; caption baseline = QR_TOP + QR_SIZE + 8
    const captionY = QR_TOP + QR_SIZE + 8   // = 37
    setTxt(doc, BW.label)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    doc.text('Scan for digital record', qrX + QR_SIZE / 2, captionY, { align: 'center' })
    if (baby.rop_id) {
      setTxt(doc, BW.black)
      doc.setFont('times', 'bold')
      doc.setFontSize(12)
      doc.text(baby.rop_id, qrX + QR_SIZE / 2, captionY + 7, { align: 'center' })
    }
  }

  // Divider — sits below all header elements on both sides
  setDraw(doc, BW.black)
  doc.setLineWidth(0.5)
  doc.line(ML, 51, PW - MR, 51)

  let y = 59

  // ── Patient Information ───────────────────────────────────────────────────
  y = bwSectionHeading(doc, y, 'Patient Information')

  const bdRows = [
    ...(baby.rop_id ? [['ROP Tracker ID', baby.rop_id, 'Hospital', hospitalName || '-']] : []),
    ['Full Name',    baby.full_name,                          'Date of Birth',   fmtDate(baby.date_of_birth)],
    ['Sex',          baby.sex === 'male' ? 'Male' : 'Female', 'Gestational Age', `${baby.gestational_age_weeks} weeks`],
    ['Birth Weight', `${baby.birth_weight_grams}g`,           'Caregiver',       baby.caregiver_name],
    ['MTN Phone',    baby.mtn_phone || '-',                   'Airtel Phone',    baby.airtel_phone || '-'],
  ]
  bwTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    body: bdRows,
    styles: { fontSize: 12, cellPadding: 2.5 },
    columnStyles: {
      0: { font: 'times', fontStyle: 'bold', fontSize: 12, textColor: BW.label, cellWidth: 38 },
      1: { cellWidth: 52 },
      2: { font: 'times', fontStyle: 'bold', fontSize: 12, textColor: BW.label, cellWidth: 38 },
      3: { cellWidth: 'auto' },
    },
  })
  y = doc.lastAutoTable.finalY + 7

  // ── Risk Factors ──────────────────────────────────────────────────────────
  y = bwSectionHeading(doc, y, 'Risk Factors')
  const risks = [
    ['Oxygen Therapy',    baby.oxygen_therapy],
    ['Blood Transfusion', baby.blood_transfusion],
    ['Sepsis',            baby.sepsis],
    ['Inotropes',         baby.inotropes],
    ['Anaemia',           baby.anaemia],
  ]
  const activeRisks = risks.filter(r => r[1]).map(r => r[0])
  doc.setFont('times', 'normal')
  doc.setFontSize(12)
  if (activeRisks.length) {
    setTxt(doc, BW.black)
    for (const risk of activeRisks) {
      doc.text(`•  ${risk}`, ML + 3, y)
      y += 6
    }
  } else {
    setTxt(doc, BW.label)
    doc.text('No risk factors recorded', ML + 3, y)
    y += 6
  }
  y += 5

  // ── Eye Findings ──────────────────────────────────────────────────────────
  y = bwSectionHeading(doc, y, `Examination: ${fmtDate(exam.exam_date)}`)
  bwTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['Eye', 'Zone', 'Stage', 'Plus Disease']],
    body: [
      ['Right Eye (OD)', ZONE_LABELS[exam.right_zone] || '-', STAGE_LABELS[exam.right_stage] || '-', PLUS_LABELS[exam.right_plus] || 'None'],
      ['Left Eye (OS)',  ZONE_LABELS[exam.left_zone]  || '-', STAGE_LABELS[exam.left_stage]  || '-', PLUS_LABELS[exam.left_plus]  || 'None'],
    ],
    styles: { fontSize: 12, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold' } },
  })
  y = doc.lastAutoTable.finalY + 5

  const worstStr = exam.worst_zone
    ? `Worst Finding: ${ZONE_LABELS[exam.worst_zone] || exam.worst_zone} / ${STAGE_LABELS[exam.worst_stage] || '-'}${exam.has_plus_disease === 'yes' ? ' + Plus Disease' : ''}`
    : 'Worst Finding: No ROP recorded'
  setTxt(doc, BW.black)
  doc.setFont('times', 'bold')
  doc.setFontSize(12)
  doc.text(worstStr, ML + 3, y + 6)
  y += 14

  // ── Treatment ─────────────────────────────────────────────────────────────
  if (exam.treatment_recommended) {
    y = bwSectionHeading(doc, y, 'Treatment Recommended')
    setTxt(doc, BW.black)
    doc.setFont('times', 'bold')
    doc.setFontSize(12)
    doc.text(TREATMENT_LABELS[exam.treatment_recommended] || exam.treatment_recommended, ML + 3, y)
    y += 12
  }

  // ── Next Appointment ──────────────────────────────────────────────────────
  if (exam.next_exam_weeks) {
    y = bwSectionHeading(doc, y, 'Next Appointment')
    setTxt(doc, BW.black)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    doc.text(`Return in ${exam.next_exam_weeks} week${exam.next_exam_weeks > 1 ? 's' : ''} for next examination`, ML + 3, y)
    y += 12
  }

  // ── Clinical Notes ────────────────────────────────────────────────────────
  if (exam.notes) {
    y = bwSectionHeading(doc, y, 'Clinical Notes')
    setTxt(doc, BW.black)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    const lines = doc.splitTextToSize(exam.notes, CW - 6)
    doc.text(lines, ML + 3, y)
    y += lines.length * 6 + 6
  }

  // ── Visual Function ───────────────────────────────────────────────────────
  if (hasVFData(exam)) {
    y = addVFSectionBW(doc, exam, y)
  }

  // ── Signature block ───────────────────────────────────────────────────────
  y = Math.max(y + 8, PH - 55)
  const sigCols = [ML, ML + CW / 3, ML + (CW / 3) * 2]
  const sigW = CW / 3 - 4
  const sigLabels = ['Examined by (Print Name)', 'Signature', 'Date']
  setDraw(doc, BW.border)
  doc.setLineWidth(0.3)
  for (let i = 0; i < 3; i++) {
    doc.line(sigCols[i], y + 15, sigCols[i] + sigW, y + 15)
    setTxt(doc, BW.label)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    doc.text(sigLabels[i], sigCols[i], y + 22)
  }

  bwFooter(doc, 1, 1)
  doc.save(`ROP-Visit-${baby.full_name.replace(/\s+/g, '-')}-${exam.exam_date}.pdf`)
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE 2B — Full Baby Summary  (black & white, all visits most recent first)
// ─────────────────────────────────────────────────────────────────────────────
export async function generateBabyFullPDF(baby, exams, hospitalName) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const babyUrl = `https://rop-tracker.vercel.app/babies/${baby.id}`
  const qr = await qrDataUrlBW(babyUrl)

  const sortedExams = [...exams].sort((a, b) => new Date(b.exam_date) - new Date(a.exam_date))
  const totalPages = sortedExams.length + 1

  // ── COVER ─────────────────────────────────────────────────────────────────
  // QR: top=5, size=26 → bottom=31; caption baseline=39; divider=51
  const QR_SIZE = 26
  const QR_TOP  = 5
  const qrX = PW - MR - QR_SIZE

  // Left text — all Times 12pt, 7 mm line spacing
  setTxt(doc, BW.black)
  doc.setFont('times', 'bold')
  doc.setFontSize(12)
  doc.text('ROP SCREENING RECORD', ML, 13)

  setTxt(doc, BW.label)
  doc.setFont('times', 'normal')
  doc.setFontSize(12)
  doc.text('Retinopathy of Prematurity Follow-Up Network', ML, 20)
  doc.text(hospitalName || '', ML, 27)

  // QR + caption — fully above divider
  if (qr) {
    doc.addImage(qr, 'PNG', qrX, QR_TOP, QR_SIZE, QR_SIZE)
    const captionY = QR_TOP + QR_SIZE + 8   // = 39
    setTxt(doc, BW.label)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    doc.text('Scan for digital record', qrX + QR_SIZE / 2, captionY, { align: 'center' })
  }

  setDraw(doc, BW.black)
  doc.setLineWidth(0.7)
  doc.line(ML, 51, PW - MR, 51)

  let y = 59

  // Baby name and status
  setTxt(doc, BW.black)
  doc.setFont('times', 'bold')
  doc.setFontSize(12)
  doc.text(baby.full_name, ML, y)

  const statusText = STATUS_LABELS_BW[baby.status] || '[ACTIVE]'
  doc.text(statusText, PW - MR, y, { align: 'right' })

  y += 7
  if (baby.rop_id) {
    doc.text(baby.rop_id, ML, y)
    y += 8
  }

  // Patient details table
  const patientRows = [
    ['Date of Birth',   fmtDate(baby.date_of_birth),       'Sex',         baby.sex === 'male' ? 'Male' : 'Female'],
    ['Gestational Age', `${baby.gestational_age_weeks}w`,  'Birth Weight', `${baby.birth_weight_grams}g`],
    ['Caregiver',       baby.caregiver_name,                'Phone',        baby.mtn_phone || baby.airtel_phone || '-'],
    ['Total Exams',     String(sortedExams.length),         'Enrolled',     fmtDate(baby.enrolled_at?.split('T')[0] || '')],
  ]
  bwTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    body: patientRows,
    styles: { fontSize: 12, cellPadding: 2.5 },
    columnStyles: {
      0: { font: 'times', fontStyle: 'bold', fontSize: 12, textColor: BW.label, cellWidth: 40 },
      1: { cellWidth: 50 },
      2: { font: 'times', fontStyle: 'bold', fontSize: 12, textColor: BW.label, cellWidth: 40 },
      3: { cellWidth: 'auto' },
    },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── Risk Factors ──────────────────────────────────────────────────────────
  y = bwSectionHeading(doc, y, 'Risk Factors')
  const riskLabels = [
    ['Oxygen Therapy',    baby.oxygen_therapy],
    ['Blood Transfusion', baby.blood_transfusion],
    ['Sepsis',            baby.sepsis],
    ['Inotropes',         baby.inotropes],
    ['Anaemia',           baby.anaemia],
  ]
  const activeRisks = riskLabels.filter(r => r[1]).map(r => r[0])
  doc.setFont('times', 'normal')
  doc.setFontSize(12)
  if (activeRisks.length) {
    setTxt(doc, BW.black)
    for (const risk of activeRisks) {
      doc.text(`•  ${risk}`, ML + 3, y)
      y += 6
    }
  } else {
    setTxt(doc, BW.label)
    doc.text('No risk factors recorded', ML + 3, y)
    y += 6
  }
  y += 5

  // ── Clinical Notes ────────────────────────────────────────────────────────
  if (baby.notes) {
    y = bwSectionHeading(doc, y, 'Clinical Notes')
    setTxt(doc, BW.black)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    const lines = doc.splitTextToSize(baby.notes, CW - 6)
    doc.text(lines, ML + 3, y)
    y += lines.length * 6 + 8
  }

  // ── Examination History Summary ───────────────────────────────────────────
  y = bwSectionHeading(doc, y, 'Examination History Summary')
  bwTable(doc, {
    startY: y,
    margin: { left: ML, right: MR },
    head: [['#', 'Date', 'Right Eye (OD)', 'Left Eye (OS)', 'Worst Finding', 'Next (wks)']],
    body: [...sortedExams].reverse().map((e, i) => [
      i + 1,
      fmtDate(e.exam_date),
      eyeStr(e.right_zone, e.right_stage, e.right_plus),
      eyeStr(e.left_zone,  e.left_stage,  e.left_plus),
      e.worst_zone
        ? `${ZONE_LABELS[e.worst_zone] || e.worst_zone} / ${STAGE_LABELS[e.worst_stage] || '-'}`
        : '-',
      e.next_exam_weeks != null ? String(e.next_exam_weeks) : '-',
    ]),
    styles: { fontSize: 12, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 24 },
      5: { cellWidth: 18, halign: 'center' },
    },
  })
  y = doc.lastAutoTable.finalY + 8

  // ── Visual Function Trajectory ────────────────────────────────────────────
  const vfExams = sortedExams.filter(hasVFData)
  if (vfExams.length > 0) {
    y = bwSectionHeading(doc, y, 'Visual Function Trajectory')
    bwTable(doc, {
      startY: y,
      margin: { left: ML, right: MR },
      head: [['Date', 'OD Fix', 'OD Follow', 'OD CSM', 'OS Fix', 'OS Follow', 'OS CSM', 'Impression']],
      body: [...vfExams].reverse().map(e => [
        fmtDate(e.exam_date),
        VF_FIXATION_LABELS[e.vf_right_fixation]          || '-',
        VF_FOLLOWING_LABELS[e.vf_right_following]         || '-',
        VF_CSM_LABELS[e.vf_right_csm]                    || '-',
        VF_FIXATION_LABELS[e.vf_left_fixation]            || '-',
        VF_FOLLOWING_LABELS[e.vf_left_following]          || '-',
        VF_CSM_LABELS[e.vf_left_csm]                     || '-',
        VF_IMPRESSION_LABELS[e.vf_functional_impression]  || '-',
      ]),
      styles: { fontSize: 12, cellPadding: 2 },
      columnStyles: { 0: { cellWidth: 22 }, 7: { cellWidth: 38 } },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  bwFooter(doc, 1, totalPages)

  // ── One page per exam ─────────────────────────────────────────────────────
  for (let ei = 0; ei < sortedExams.length; ei++) {
    const exam = sortedExams[ei]
    doc.addPage()

    // Running header — Times 12pt
    setTxt(doc, BW.black)
    doc.setFont('times', 'bold')
    doc.setFontSize(12)
    doc.text(`${baby.full_name}  |  Complete Clinical Record`, ML, 11)
    doc.setFont('times', 'normal')
    doc.text(`Exam ${ei + 1} of ${sortedExams.length}`, PW - MR, 11, { align: 'right' })
    setDraw(doc, BW.black)
    doc.setLineWidth(0.4)
    doc.line(ML, 14, PW - MR, 14)

    let ey = 23

    // Exam date heading
    setTxt(doc, BW.black)
    doc.setFont('times', 'bold')
    doc.setFontSize(12)
    doc.text(`Examination: ${fmtDate(exam.exam_date)}`, ML, ey + 6)

    const worstLabel = exam.worst_zone
      ? `${ZONE_LABELS[exam.worst_zone] || exam.worst_zone} / ${STAGE_LABELS[exam.worst_stage] || '-'}${exam.has_plus_disease === 'yes' ? ' + Plus Disease' : ''}`
      : 'No finding recorded'
    setTxt(doc, BW.label)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    doc.text(`Worst: ${worstLabel}`, ML, ey + 13)
    ey += 22

    // Eye findings table
    bwTable(doc, {
      startY: ey,
      margin: { left: ML, right: MR },
      head: [['Eye', 'Zone', 'Stage', 'Plus Disease']],
      body: [
        ['Right Eye (OD)', ZONE_LABELS[exam.right_zone] || '-', STAGE_LABELS[exam.right_stage] || '-', PLUS_LABELS[exam.right_plus] || 'None'],
        ['Left Eye (OS)',  ZONE_LABELS[exam.left_zone]  || '-', STAGE_LABELS[exam.left_stage]  || '-', PLUS_LABELS[exam.left_plus]  || 'None'],
      ],
      styles: { fontSize: 12, cellPadding: 3 },
      columnStyles: { 0: { fontStyle: 'bold' } },
    })
    ey = doc.lastAutoTable.finalY + 6

    // Additional details
    const detailRows = []
    if (exam.postnatal_age_days != null) detailRows.push(['Postnatal Age at Exam', `${exam.postnatal_age_days} days`])
    if (exam.treatment_recommended) detailRows.push(['Treatment Recommended', TREATMENT_LABELS[exam.treatment_recommended] || exam.treatment_recommended])
    if (exam.next_exam_weeks) detailRows.push(['Next Exam', `In ${exam.next_exam_weeks} week${exam.next_exam_weeks > 1 ? 's' : ''}`])

    if (detailRows.length) {
      bwTable(doc, {
        startY: ey,
        margin: { left: ML, right: MR },
        body: detailRows,
        styles: { fontSize: 12, cellPadding: 2.5 },
        columnStyles: {
          0: { font: 'times', fontStyle: 'bold', fontSize: 12, textColor: BW.label, cellWidth: 55 },
        },
      })
      ey = doc.lastAutoTable.finalY + 6
    }

    if (exam.notes) {
      ey = bwSectionHeading(doc, ey, 'Clinical Notes')
      setTxt(doc, BW.black)
      doc.setFont('times', 'normal')
      doc.setFontSize(12)
      const lines = doc.splitTextToSize(exam.notes, CW - 6)
      doc.text(lines, ML + 3, ey)
      ey += lines.length * 6 + 6
    }

    if (hasVFData(exam)) {
      ey = addVFSectionBW(doc, exam, ey)
    }

    // Signature block
    ey = Math.max(ey + 10, PH - 48)
    const sigCols = [ML, ML + CW / 3, ML + (CW / 3) * 2]
    const sigW = CW / 3 - 4
    const sigLabels = ['Examined by', 'Signature', 'Date']
    setDraw(doc, BW.border)
    doc.setLineWidth(0.3)
    for (let si = 0; si < 3; si++) {
      doc.line(sigCols[si], ey + 15, sigCols[si] + sigW, ey + 15)
      setTxt(doc, BW.label)
      doc.setFont('times', 'normal')
      doc.setFontSize(12)
      doc.text(sigLabels[si], sigCols[si], ey + 22)
    }

    bwFooter(doc, ei + 2, totalPages)
  }

  doc.save(`ROP-Record-${baby.full_name.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
}
