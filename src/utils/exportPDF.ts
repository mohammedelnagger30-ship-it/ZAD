/**
 * PDF Export utility for progress reports
 * Uses jsPDF and jsPDF-AutoTable for generating professional reports
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from '@/db/database';
import { getStreakCount } from '@/utils/taskManager';
import { getWeeklyPrayerStats, getMonthlyPrayerStats } from '@/utils/prayerTracker';
import { TOTAL_QURAN_AYAHS, toArabicNumber } from '@/data/surahs';

export interface ProgressReportData {
  streak: number;
  memorizedAyahs: number;
  memorizationPercent: number;
  weeklyStats: { percentage: number; ontime: number; late: number; missed: number };
  monthlyStats: { percentage: number; ontime: number; late: number; missed: number };
  totalTasks: number;
  doneTasks: number;
  taskCompletionPercent: number;
  exportDate: string;
}

export async function generateProgressReport(): Promise<ProgressReportData> {
  const streak = await getStreakCount();
  const weeklyStats = await getWeeklyPrayerStats();
  const monthlyStats = await getMonthlyPrayerStats();

  // Memorization progress
  const progress = await db.hifzProgress.toArray();
  const uniqueAyahs = new Set<string>();
  progress.forEach((p) => {
    for (let i = p.ayahStart; i <= p.ayahEnd; i++) {
      uniqueAyahs.add(`${p.surahId}:${i}`);
    }
  });
  const memorizedAyahs = uniqueAyahs.size;
  const memorizationPercent = Math.round((memorizedAyahs / TOTAL_QURAN_AYAHS) * 100);

  // Task completion
  const allTasks = await db.tasks.toArray();
  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter((t) => t.status === 'done').length;
  const taskCompletionPercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return {
    streak,
    memorizedAyahs,
    memorizationPercent,
    weeklyStats,
    monthlyStats,
    totalTasks,
    doneTasks,
    taskCompletionPercent,
    exportDate: new Date().toISOString(),
  };
}

export function exportProgressToPDF(data: ProgressReportData): void {
  const doc = new jsPDF();

  // Set font for Arabic (default font supports basic Arabic)
  // For full Arabic support, you'd need to add a custom font
  doc.setFont('helvetica');

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  let yPosition = 20;

  // Title
  doc.setFontSize(20);
  doc.setTextColor(31, 115, 78); // Primary green color
  doc.text('تقرير التقدم - تطبيق قُرّة', pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 15;

  // Export date
  doc.setFontSize(10);
  doc.setTextColor(100);
  const exportDate = new Date(data.exportDate).toLocaleDateString('ar-EG');
  doc.text(`تاريخ التصدير: ${exportDate}`, pageWidth / 2, yPosition, { align: 'center' });
  yPosition += 20;

  // Streak section
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('سلسلة الالتزام', margin, yPosition);
  yPosition += 10;

  doc.setFontSize(12);
  doc.setTextColor(31, 115, 78);
  doc.text(`${toArabicNumber(data.streak)} يوم متتالي`, margin, yPosition);
  yPosition += 20;

  // Memorization progress
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('تقدم الحفظ', margin, yPosition);
  yPosition += 10;

  doc.setFontSize(12);
  doc.setTextColor(31, 115, 78);
  doc.text(`النسبة: ${data.memorizationPercent}%`, margin, yPosition);
  yPosition += 7;
  doc.setTextColor(100);
  doc.text(
    `${toArabicNumber(data.memorizedAyahs)} من ${toArabicNumber(TOTAL_QURAN_AYAHS)} آية`,
    margin,
    yPosition
  );
  yPosition += 20;

  // Prayer stats table
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('إحصائيات الصلاة', margin, yPosition);
  yPosition += 10;

  autoTable(doc, {
    startY: yPosition,
    head: [['الفترة', 'النسبة', 'في وقتها', 'قضاء', 'فائتة']],
    body: [
      [
        'هذا الأسبوع',
        `${data.weeklyStats.percentage}%`,
        toArabicNumber(data.weeklyStats.ontime),
        toArabicNumber(data.weeklyStats.late),
        toArabicNumber(data.weeklyStats.missed),
      ],
      [
        'هذا الشهر',
        `${data.monthlyStats.percentage}%`,
        toArabicNumber(data.monthlyStats.ontime),
        toArabicNumber(data.monthlyStats.late),
        toArabicNumber(data.monthlyStats.missed),
      ],
    ],
    theme: 'grid',
    headStyles: {
      fillColor: [31, 115, 78],
      textColor: 255,
      fontStyle: 'bold',
    },
    styles: {
      font: 'helvetica',
      fontSize: 10,
    },
  });

  // jspdf-autotable writes the last table's geometry back onto the document; the type
  // augmentation is not shipped, so it is named here rather than silenced with `any`.
  const lastAutoTable = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
  yPosition = (lastAutoTable?.finalY ?? yPosition) + 20;

  // Task completion
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('إنجاز المهام', margin, yPosition);
  yPosition += 10;

  doc.setFontSize(12);
  doc.setTextColor(31, 115, 78);
  doc.text(`النسبة: ${data.taskCompletionPercent}%`, margin, yPosition);
  yPosition += 7;
  doc.setTextColor(100);
  doc.text(
    `${toArabicNumber(data.doneTasks)} من ${toArabicNumber(data.totalTasks)} مهمة مكتملة`,
    margin,
    yPosition
  );

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `صفحة ${i} من ${pageCount} - تطبيق قُرّة`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save the PDF
  const fileName = `qurra-progress-report-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
}

export async function exportProgressReport(): Promise<void> {
  try {
    const data = await generateProgressReport();
    exportProgressToPDF(data);
  } catch (error) {
    console.error('Failed to export progress report:', error);
    throw new Error('تعذّر تصدير تقرير التقدم');
  }
}
