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
  doc.text('CONFIDENTIAL — For clinical use only', PW / 2, y + 2, { align: 'center' })
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
  y = sectionHeading(doc, y, 'LTFU Analysis — Missed Appointments')
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
    y = sectionHeading(doc, y, 'Monthly Trend — Enrollments & Exams')
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
// TYPE 2A — Single Visit Report
// ─────────────────────────────────────────────────────────────────────────────
export async function generateSingleVisitPDF(baby, exam, hospitalName) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const babyUrl = `${window.location.origin}/babies/${baby.id}`
  const qr = await qrDataUrl(babyUrl)

  // Header band
  setFill(doc, C.teal)
  doc.rect(0, 0, PW, 18, 'F')
  setTxt(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('ROP Tracker Uganda', ML, 8)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(hospitalName || 'Uganda ROP Network', ML, 13.5)
  doc.text('Retinal Examination Report', PW - MR, 8, { align: 'right' })
  doc.text(`Date: ${fmtNow()}`, PW - MR, 13.5, { align: 'right' })

  let y = 24

  // QR code top-right
  if (qr) {
    doc.addImage(qr, 'PNG', PW - MR - 24, y, 24, 24)
    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.text('Scan for digital record', PW - MR - 12, y + 27, { align: 'center' })
  }

  // ── Baby details ──
  y = sectionHeading(doc, y, 'Patient Information')
  const bdRows = [
    ['Full Name', baby.full_name, 'Date of Birth', fmtDate(baby.date_of_birth)],
    ['Sex', baby.sex === 'male' ? 'Male' : 'Female', 'Gestational Age', `${baby.gestational_age_weeks} weeks`],
    ['Birth Weight', `${baby.birth_weight_grams}g`, 'Caregiver', baby.caregiver_name],
    ['MTN Phone', baby.mtn_phone || '-', 'Airtel Phone', baby.airtel_phone || '-'],
  ]
  for (const [l1, v1, l2, v2] of bdRows) {
    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(l1 + ':', ML, y)
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text(v1 || '-', ML + 30, y)
    if (l2) {
      setTxt(doc, C.gray500)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(l2 + ':', ML + CW / 2, y)
      setTxt(doc, C.gray900)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.text(v2 || '-', ML + CW / 2 + 35, y)
    }
    y += 7.5
  }
  y += 2

  // ── Risk factors ──
  y = sectionHeading(doc, y, 'Risk Factors')
  const risks = [
    ['Oxygen Therapy', baby.oxygen_therapy],
    ['Blood Transfusion', baby.blood_transfusion],
    ['Sepsis', baby.sepsis],
    ['Inotropes', baby.inotropes],
    ['Anaemia', baby.anaemia],
  ]
  const activeRisks = risks.filter(r => r[1]).map(r => r[0])
  setTxt(doc, activeRisks.length ? C.red : C.gray500)
  doc.setFont('helvetica', activeRisks.length ? 'bold' : 'normal')
  doc.setFontSize(9)
  doc.text(activeRisks.length ? activeRisks.join('  ·  ') : 'No risk factors recorded', ML + 3, y)
  y += 10

  // ── Exam details ──
  y = sectionHeading(doc, y, `Examination — ${fmtDate(exam.exam_date)}`)

  // Two eye boxes side by side
  const eyeW = (CW - 6) / 2
  const eyeH = 30

  // Right eye box
  setFill(doc, [239, 246, 255])
  doc.rect(ML, y, eyeW, eyeH, 'F')
  setFill(doc, [37, 99, 235])
  doc.rect(ML, y, eyeW, 2, 'F')
  setTxt(doc, [37, 99, 235])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('RIGHT EYE (OD)', ML + eyeW / 2, y + 7, { align: 'center' })
  setTxt(doc, C.gray900)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(eyeStr(exam.right_zone, exam.right_stage, exam.right_plus), ML + eyeW / 2, y + 16, { align: 'center' })
  setTxt(doc, C.gray500)
  doc.setFontSize(7.5)
  doc.text(`Plus: ${PLUS_LABELS[exam.right_plus] || 'None'}`, ML + eyeW / 2, y + 24, { align: 'center' })

  // Left eye box
  const lx = ML + eyeW + 6
  setFill(doc, [240, 253, 244])
  doc.rect(lx, y, eyeW, eyeH, 'F')
  setFill(doc, [22, 163, 74])
  doc.rect(lx, y, eyeW, 2, 'F')
  setTxt(doc, [22, 163, 74])
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.text('LEFT EYE (OS)', lx + eyeW / 2, y + 7, { align: 'center' })
  setTxt(doc, C.gray900)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(eyeStr(exam.left_zone, exam.left_stage, exam.left_plus), lx + eyeW / 2, y + 16, { align: 'center' })
  setTxt(doc, C.gray500)
  doc.setFontSize(7.5)
  doc.text(`Plus: ${PLUS_LABELS[exam.left_plus] || 'None'}`, lx + eyeW / 2, y + 24, { align: 'center' })

  y += eyeH + 6

  // Worst finding summary
  setFill(doc, exam.worst_zone === 'zone_i' ? [254, 226, 226] : exam.worst_zone === 'zone_ii' ? [255, 237, 213] : C.tealLight)
  doc.rect(ML, y, CW, 8, 'F')
  setTxt(doc, exam.worst_zone === 'zone_i' ? C.red : exam.worst_zone === 'zone_ii' ? C.amber : C.tealText)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  const worstStr = exam.worst_zone
    ? `Worst Finding: ${ZONE_LABELS[exam.worst_zone] || exam.worst_zone} / ${STAGE_LABELS[exam.worst_stage] || '-'}${exam.has_plus_disease === 'yes' ? ' + Plus Disease' : ''}`
    : 'No ROP Finding Recorded'
  doc.text(worstStr, ML + 3, y + 5.5)
  y += 12

  // Treatment + next appointment
  if (exam.treatment_recommended) {
    y = sectionHeading(doc, y, 'Treatment Recommended')
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.text(TREATMENT_LABELS[exam.treatment_recommended] || exam.treatment_recommended, ML + 3, y)
    y += 10
  }

  if (exam.next_exam_weeks) {
    y = sectionHeading(doc, y, 'Next Appointment')
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(`Return in ${exam.next_exam_weeks} week${exam.next_exam_weeks > 1 ? 's' : ''} for next examination`, ML + 3, y)
    y += 10
  }

  if (exam.notes) {
    y = sectionHeading(doc, y, 'Clinical Notes')
    setTxt(doc, C.gray700)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(exam.notes, CW - 6)
    doc.text(lines, ML + 3, y)
    y += lines.length * 5 + 5
  }

  // ── Signature block ──
  y = Math.max(y + 8, PH - 60)
  setDraw(doc, C.gray200)
  doc.setLineWidth(0.3)
  doc.line(ML, y, ML + 3, y)

  const sigCols = [ML, ML + CW / 3, ML + (CW / 3) * 2]
  const sigLabels = ['Examined by (Print Name)', 'Signature', 'Date']
  for (let i = 0; i < 3; i++) {
    const sx = sigCols[i]
    const sw = CW / 3 - 4
    doc.line(sx, y + 15, sx + sw, y + 15)
    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(sigLabels[i], sx, y + 20)
  }

  addFooter(doc, 1, 1)
  doc.save(`ROP-Visit-${baby.full_name.replace(/\s+/g, '-')}-${exam.exam_date}.pdf`)
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE 2B — Full Baby Summary (all visits, most recent first)
// ─────────────────────────────────────────────────────────────────────────────
export async function generateBabyFullPDF(baby, exams, hospitalName) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const babyUrl = `${window.location.origin}/babies/${baby.id}`
  const qr = await qrDataUrl(babyUrl)

  const sortedExams = [...exams].sort((a, b) => new Date(b.exam_date) - new Date(a.exam_date))

  // ── COVER ─────────────────────────────────────────────────────────────────
  setFill(doc, C.teal)
  doc.rect(0, 0, PW, 50, 'F')

  setTxt(doc, C.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text('ROP Tracker Uganda', ML, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.text('Complete Clinical Record — All Examinations', ML, 23)
  doc.text(hospitalName || '', ML, 30)

  if (qr) {
    doc.addImage(qr, 'PNG', PW - MR - 26, 12, 26, 26)
  }

  setFill(doc, [255, 255, 255])
  doc.rect(0, 50, PW, 1.5, 'F')

  let y = 60

  // Baby summary box
  setFill(doc, C.gray100)
  doc.roundedRect(ML, y, CW, 48, 3, 3, 'F')
  setDraw(doc, C.gray200)
  doc.setLineWidth(0.3)
  doc.roundedRect(ML, y, CW, 48, 3, 3, 'S')

  // Left accent
  setFill(doc, C.teal)
  doc.roundedRect(ML, y, 3, 48, 1.5, 1.5, 'F')

  y += 8
  setTxt(doc, C.gray900)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(baby.full_name, ML + 8, y)

  const statusColor = baby.status === 'ltfu' ? C.red : baby.status === 'active' ? C.teal : C.gray500
  setTxt(doc, statusColor)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text((baby.status || 'active').toUpperCase(), PW - MR, y, { align: 'right' })

  y += 9
  const infoItems = [
    ['Date of Birth', fmtDate(baby.date_of_birth)],
    ['Sex', baby.sex === 'male' ? 'Male' : 'Female'],
    ['Gestational Age', `${baby.gestational_age_weeks}w`],
    ['Birth Weight', `${baby.birth_weight_grams}g`],
    ['Caregiver', baby.caregiver_name],
    ['Phone', baby.mtn_phone || baby.airtel_phone || '-'],
    ['Total Exams', sortedExams.length],
    ['Enrolled', fmtDate(baby.enrolled_at?.split('T')[0] || '')],
  ]

  const colW2 = CW / 2 - 5
  for (let i = 0; i < infoItems.length; i++) {
    const col = i % 2
    const row = Math.floor(i / 2)
    const ix = ML + 8 + col * (colW2 + 5)
    const iy = y + row * 8

    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.text(infoItems[i][0] + ':', ix, iy)
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text(String(infoItems[i][1] || '-'), ix + 32, iy)
  }
  y += Math.ceil(infoItems.length / 2) * 8 + 8

  // Risk factors
  y = sectionHeading(doc, y, 'Risk Factors')
  const riskLabels = [
    ['Oxygen Therapy', baby.oxygen_therapy],
    ['Blood Transfusion', baby.blood_transfusion],
    ['Sepsis', baby.sepsis],
    ['Inotropes', baby.inotropes],
    ['Anaemia', baby.anaemia],
  ]
  const activeRisks = riskLabels.filter(r => r[1]).map(r => r[0])
  setTxt(doc, activeRisks.length ? C.red : C.gray500)
  doc.setFont('helvetica', activeRisks.length ? 'bold' : 'normal')
  doc.setFontSize(9)
  doc.text(activeRisks.length ? activeRisks.join('  ·  ') : 'No risk factors recorded', ML + 3, y)
  y += 12

  if (baby.notes) {
    y = sectionHeading(doc, y, 'Clinical Notes')
    setTxt(doc, C.gray700)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(baby.notes, CW - 6)
    doc.text(lines, ML + 3, y)
    y += lines.length * 5 + 8
  }

  // QR note
  if (qr) {
    setTxt(doc, C.gray500)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('Scan QR code to open digital record in ROP Tracker', PW - MR, 42, { align: 'right' })
  }

  const totalPages = sortedExams.length + 1
  addFooter(doc, 1, totalPages)

  // ── One page per exam ─────────────────────────────────────────────────────
  for (let ei = 0; ei < sortedExams.length; ei++) {
    const exam = sortedExams[ei]
    doc.addPage()

    // Page header
    setFill(doc, C.teal)
    doc.rect(0, 0, PW, 13, 'F')
    setTxt(doc, C.white)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.text(`${baby.full_name}  ·  Complete Clinical Record`, ML, 8.5)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`Exam ${ei + 1} of ${sortedExams.length}`, PW - MR, 8.5, { align: 'right' })

    let ey = 20

    // Exam date heading
    const sevColor = exam.worst_zone === 'zone_i' ? C.red : exam.worst_zone === 'zone_ii' ? C.amber : C.teal
    setFill(doc, sevColor)
    doc.rect(ML, ey, 2, 12, 'F')
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(`Examination — ${fmtDate(exam.exam_date)}`, ML + 6, ey + 9)

    const worstLabel = exam.worst_zone
      ? `${ZONE_LABELS[exam.worst_zone] || exam.worst_zone} / ${STAGE_LABELS[exam.worst_stage] || '-'}${exam.has_plus_disease === 'yes' ? ' + Plus Disease' : ''}`
      : 'No finding recorded'
    setTxt(doc, sevColor)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(`Worst: ${worstLabel}`, ML + 6, ey + 15)
    ey += 22

    // Eye boxes
    const eyeW = (CW - 6) / 2
    const eyeH = 30

    setFill(doc, [239, 246, 255])
    doc.rect(ML, ey, eyeW, eyeH, 'F')
    setFill(doc, [37, 99, 235])
    doc.rect(ML, ey, eyeW, 2, 'F')
    setTxt(doc, [37, 99, 235])
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('RIGHT EYE (OD)', ML + eyeW / 2, ey + 7, { align: 'center' })
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(eyeStr(exam.right_zone, exam.right_stage, exam.right_plus), ML + eyeW / 2, ey + 15, { align: 'center' })
    setTxt(doc, C.gray500)
    doc.setFontSize(7.5)
    doc.text(`Plus Disease: ${PLUS_LABELS[exam.right_plus] || 'None'}`, ML + eyeW / 2, ey + 23, { align: 'center' })

    const lx = ML + eyeW + 6
    setFill(doc, [240, 253, 244])
    doc.rect(lx, ey, eyeW, eyeH, 'F')
    setFill(doc, [22, 163, 74])
    doc.rect(lx, ey, eyeW, 2, 'F')
    setTxt(doc, [22, 163, 74])
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.text('LEFT EYE (OS)', lx + eyeW / 2, ey + 7, { align: 'center' })
    setTxt(doc, C.gray900)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(eyeStr(exam.left_zone, exam.left_stage, exam.left_plus), lx + eyeW / 2, ey + 15, { align: 'center' })
    setTxt(doc, C.gray500)
    doc.setFontSize(7.5)
    doc.text(`Plus Disease: ${PLUS_LABELS[exam.left_plus] || 'None'}`, lx + eyeW / 2, ey + 23, { align: 'center' })

    ey += eyeH + 6

    // Additional details table
    const detailRows = []
    if (exam.postnatal_age_days != null) detailRows.push(['Postnatal Age at Exam', `${exam.postnatal_age_days} days`])
    if (exam.treatment_recommended) detailRows.push(['Treatment Recommended', TREATMENT_LABELS[exam.treatment_recommended] || exam.treatment_recommended])
    if (exam.next_exam_weeks) detailRows.push(['Next Exam', `In ${exam.next_exam_weeks} week${exam.next_exam_weeks > 1 ? 's' : ''}`])

    if (detailRows.length) {
      autoTable(doc, {
        startY: ey,
        margin: { left: ML, right: MR },
        body: detailRows,
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0: { fontStyle: 'bold', textColor: C.gray500, cellWidth: 55 } },
        alternateRowStyles: { fillColor: C.gray100 },
      })
      ey = doc.lastAutoTable.finalY + 6
    }

    if (exam.notes) {
      ey = sectionHeading(doc, ey, 'Clinical Notes')
      setTxt(doc, C.gray700)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      const lines = doc.splitTextToSize(exam.notes, CW - 6)
      doc.text(lines, ML + 3, ey)
      ey += lines.length * 5 + 6
    }

    // Signature block on each exam page
    ey = Math.max(ey + 10, PH - 45)
    const sigCols = [ML, ML + CW / 3, ML + (CW / 3) * 2]
    const sigW = CW / 3 - 4
    const sigLabels = ['Examined by', 'Signature', 'Date']
    for (let si = 0; si < 3; si++) {
      doc.line(sigCols[si], ey + 15, sigCols[si] + sigW, ey + 15)
      setTxt(doc, C.gray500)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.text(sigLabels[si], sigCols[si], ey + 20)
    }

    addFooter(doc, ei + 2, totalPages)
  }

  doc.save(`ROP-Record-${baby.full_name.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
}
