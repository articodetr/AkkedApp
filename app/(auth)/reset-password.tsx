import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Eye,
  EyeOff,
  Lock,
  Save,
  ShieldCheck,
  ArrowRight,
  KeyRound,
  Check,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';

type StrengthLevel = {
  score: number;
  label: string;
  color: string;
};

const getPasswordStrength = (password: string): StrengthLevel => {
  if (!password) return { score: 0, label: '', color: '#E5E7EB' };

  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) || /[؀-ۿ]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score: 1, label: 'ضعيفة', color: '#EF4444' };
  if (score === 3) return { score: 2, label: 'متوسطة', color: '#F59E0B' };
  if (score === 4) return { score: 3, label: 'قوية', color: '#10B981' };
  return { score: 4, label: 'ممتازة', color: '#059669' };
};

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const strength = useMemo(() => getPasswordStrength(password), [password]);
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsDontMatch =
    confirmPassword.length > 0 && password !== confirmPassword;

  const handleSave = async () => {
    setError('');

    if (password.length < 6) {
      setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (password !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }

    setIsSaving(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message || 'تعذّر تغيير كلمة المرور');
        return;
      }

      await supabase.auth.signOut();
      Alert.alert('تم بنجاح', 'تم تغيير كلمة المرور. يمكنك تسجيل الدخول الآن.', [
        { text: 'تسجيل الدخول', onPress: () => router.replace('/(auth)/login') },
      ]);
    } catch (saveError) {
      console.error('[ResetPassword] save error:', saveError);
      setError('حدث خطأ أثناء تغيير كلمة المرور');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#4F46E5" />

      <LinearGradient
        colors={['#6366F1', '#4F46E5', '#4338CA']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.gradientHeader, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.headerTopRow}>
          <TouchableOpacity
            style={styles.backCircle}
            onPress={() => router.replace('/(auth)/login')}
            activeOpacity={0.85}
            disabled={isSaving}
          >
            <ArrowRight size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={styles.brandWrap}>
            <Text style={styles.brandText}>أكِّد</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.heroBlock}>
          <View style={styles.iconOuterRing}>
            <View style={styles.iconInnerCircle}>
              <KeyRound size={40} color="#4F46E5" />
            </View>
          </View>

          <Text style={styles.heroTitle}>كلمة مرور جديدة</Text>
          <Text style={styles.heroSubtitle}>
            اختر كلمة مرور قوية ولا تشاركها مع أحد
          </Text>
        </View>
      </LinearGradient>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardWrap}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionDot} />
              <Text style={styles.sectionTitle}>اختر كلمة مرور جديدة</Text>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View
              style={[
                styles.inputCard,
                password.length > 0 && { borderColor: strength.color },
              ]}
            >
              <View style={styles.inputIconWrap}>
                <Lock size={20} color="#4F46E5" />
              </View>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="كلمة المرور الجديدة"
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showPassword}
                textAlign="right"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                editable={!isSaving}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                style={styles.eyeButton}
                disabled={isSaving}
              >
                {showPassword ? (
                  <EyeOff size={20} color="#6B7280" />
                ) : (
                  <Eye size={20} color="#6B7280" />
                )}
              </TouchableOpacity>
            </View>

            {password.length > 0 ? (
              <View style={styles.strengthWrap}>
                <View style={styles.strengthBars}>
                  {[1, 2, 3, 4].map((index) => (
                    <View
                      key={index}
                      style={[
                        styles.strengthBar,
                        {
                          backgroundColor:
                            index <= strength.score ? strength.color : '#E5E7EB',
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>
                  {strength.label}
                </Text>
              </View>
            ) : null}

            <View
              style={[
                styles.inputCard,
                { marginTop: 16 },
                passwordsMatch && { borderColor: '#10B981' },
                passwordsDontMatch && { borderColor: '#EF4444' },
              ]}
            >
              <View style={styles.inputIconWrap}>
                <ShieldCheck size={20} color="#4F46E5" />
              </View>
              <TextInput
                style={styles.input}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder="تأكيد كلمة المرور"
                placeholderTextColor="#9CA3AF"
                secureTextEntry={!showConfirmPassword}
                textAlign="right"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSave}
                editable={!isSaving}
              />
              {passwordsMatch ? (
                <View style={styles.matchIcon}>
                  <Check size={16} color="#FFFFFF" />
                </View>
              ) : passwordsDontMatch ? (
                <View style={[styles.matchIcon, { backgroundColor: '#EF4444' }]}>
                  <X size={16} color="#FFFFFF" />
                </View>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={styles.eyeButton}
                  disabled={isSaving}
                >
                  {showConfirmPassword ? (
                    <EyeOff size={20} color="#6B7280" />
                  ) : (
                    <Eye size={20} color="#6B7280" />
                  )}
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.requirementsBox}>
              <RequirementRow
                ok={password.length >= 6}
                text="6 أحرف على الأقل"
              />
              <RequirementRow
                ok={password.length >= 10}
                text="10 أحرف أو أكثر (موصى به)"
              />
              <RequirementRow
                ok={/[0-9]/.test(password)}
                text="تحوي رقماً واحداً على الأقل"
              />
              <RequirementRow
                ok={passwordsMatch}
                text="كلمتا المرور متطابقتان"
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={isSaving}
              activeOpacity={0.85}
            >
              {isSaving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Save size={18} color="#FFFFFF" />
                  <Text style={styles.primaryButtonText}>حفظ كلمة المرور</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function RequirementRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={styles.requirementRow}>
      <View
        style={[
          styles.requirementCircle,
          { backgroundColor: ok ? '#10B981' : '#E5E7EB' },
        ]}
      >
        {ok ? <Check size={12} color="#FFFFFF" /> : null}
      </View>
      <Text
        style={[
          styles.requirementText,
          ok && { color: '#047857', fontWeight: '600' },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  gradientHeader: {
    paddingHorizontal: 20,
    paddingBottom: 80,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandWrap: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
  },
  brandText: {
    fontSize: 16,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    lineHeight: 22,
    includeFontPadding: false,
  },
  heroBlock: {
    alignItems: 'center',
    paddingTop: 8,
  },
  iconOuterRing: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconInnerCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 10,
    lineHeight: 36,
  },
  heroSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.88)',
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 24,
  },
  keyboardWrap: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 16,
    marginTop: -20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingTop: 36,
    paddingHorizontal: 24,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionDot: {
    width: 6,
    height: 22,
    backgroundColor: '#4F46E5',
    borderRadius: 3,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111827',
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    paddingHorizontal: 14,
    height: 60,
  },
  inputIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  eyeButton: {
    padding: 4,
  },
  matchIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    marginBottom: 4,
  },
  strengthBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    minWidth: 56,
    textAlign: 'left',
  },
  requirementsBox: {
    marginTop: 18,
    marginBottom: 20,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  requirementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  requirementCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requirementText: {
    flex: 1,
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'right',
  },
  errorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  primaryButton: {
    width: '100%',
    height: 56,
    backgroundColor: '#4F46E5',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
