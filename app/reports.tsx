import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowRight, FileText, ClipboardList } from 'lucide-react-native';

const reportTypes = [
  {
    title: 'تقرير الديون الشامل',
    description: 'عرض أرصدة جميع العملاء بكل العملات مع إمكانية التصدير',
    icon: FileText,
    color: '#5B5AF7',
    route: '/debt-summary',
  },
  {
    title: 'الديون',
    description: 'عرض الديون المستحقة والمدفوعة بشكل مبسط',
    icon: ClipboardList,
    color: '#F97316',
    route: '/debts',
  },
];

export default function ReportsScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.topHeader}>
          <View style={styles.headerSpacer} />
          <Text style={styles.pageTitle}>التقارير</Text>
          <TouchableOpacity style={styles.topIconButton} onPress={() => router.back()}>
            <ArrowRight size={18} color="#1E1B4B" />
          </TouchableOpacity>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>اختر التقرير</Text>
          <Text style={styles.sectionSubtitle}>واجهة مبسطة وواضحة بنفس أسلوب الإحصائيات</Text>

          <View style={styles.cardsWrap}>
            {reportTypes.map((report) => (
              <TouchableOpacity
                key={report.route}
                activeOpacity={0.88}
                style={styles.reportCard}
                onPress={() => router.push(report.route as any)}
              >
                <View style={[styles.reportIconWrap, { backgroundColor: `${report.color}12` }]}>
                  <report.icon size={18} color={report.color} />
                </View>

                <View style={styles.reportTextWrap}>
                  <Text style={styles.reportTitle}>{report.title}</Text>
                  <Text style={styles.reportDescription}>{report.description}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F7F7FC',
  },
  screen: {
    flex: 1,
  },
  contentContainer: {
    padding: 14,
    paddingBottom: 24,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    marginTop: 6,
  },
  topIconButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  headerSpacer: {
    width: 42,
    height: 42,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#1E1B4B',
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ECECF7',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#1E1B4B',
    textAlign: 'right',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#7C84A3',
    fontWeight: '500',
    textAlign: 'right',
    marginTop: 2,
    marginBottom: 12,
  },
  cardsWrap: {
    gap: 10,
  },
  reportCard: {
    borderWidth: 1,
    borderColor: '#E3E7F2',
    borderRadius: 16,
    padding: 12,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  reportTextWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2937',
    textAlign: 'right',
  },
  reportDescription: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'right',
    marginTop: 4,
  },
});
