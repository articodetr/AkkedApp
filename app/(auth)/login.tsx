import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, User } from 'lucide-react-native';

export default function LoginScreen() {
  const [userName, setUserName] = useState('');
  const [pin, setPin] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handlePinChange = (text: string) => {
    const numbersOnly = text.replace(/[^0-9]/g, '').slice(0, 20);
    setPin(numbersOnly);
  };

  const handleLogin = async () => {
    if (!userName.trim()) {
      Alert.alert('خطأ', 'الرجاء إدخال اسم المستخدم');
      return;
    }

    if (pin.length < 6) {
      Alert.alert('خطأ', 'كلمة المرور يجب أن تكون 6 أرقام على الأقل');
      return;
    }

    if (pin.length > 20) {
      Alert.alert('خطأ', 'كلمة المرور يجب أن لا تزيد عن 20 رقم');
      return;
    }

    setIsLoading(true);
    const result = await login(userName.trim(), pin);
    setIsLoading(false);

    if (result.success) {
      router.replace('/(tabs)');
    } else {
      Alert.alert('خطأ', result.error || 'اسم المستخدم أو كلمة المرور غير صحيحة');
      setPin('');
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.logoContainer}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={styles.logoImage}
            resizeMode="contain"
          />
        </View>

        <Text style={styles.title}>ArtiCode</Text>
        <Text style={styles.subtitle}>أدخل بياناتك للدخول</Text>

        <View style={styles.inputContainer}>
          <User size={20} color="#6B7280" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            value={userName}
            onChangeText={setUserName}
            placeholder="اسم المستخدم"
            placeholderTextColor="#9CA3AF"
            textAlign="right"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputContainer}>
          <Lock size={20} color="#6B7280" style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={handlePinChange}
            placeholder="كلمة المرور (6 أرقام على الأقل)"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            maxLength={20}
            keyboardType="number-pad"
            textAlign="right"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {pin.length > 0 && (
          <View style={styles.lengthIndicator}>
            <Text
              style={[
                styles.lengthText,
                pin.length >= 6 && pin.length <= 20
                  ? styles.lengthTextValid
                  : styles.lengthTextInvalid,
              ]}
            >
              {pin.length} / 20 رقم
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>{isLoading ? 'جاري التحقق...' : 'دخول'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.registerButton}
          onPress={() => router.push('/(auth)/register')}
          disabled={isLoading}
        >
          <Text style={styles.registerButtonText}>ليس لديك حساب؟ إنشاء حساب جديد</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 24,
    backgroundColor: '#F9FAFB',
  },
  logoContainer: {
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 32,
    textAlign: 'center',
  },
  inputContainer: {
    width: '100%',
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    paddingHorizontal: 16,
    height: 64,
  },
  inputIcon: {
    marginLeft: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  button: {
    width: '100%',
    height: 56,
    backgroundColor: '#4F46E5',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  lengthIndicator: {
    width: '100%',
    marginTop: 8,
    marginBottom: 16,
  },
  lengthText: {
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '500',
  },
  lengthTextValid: {
    color: '#10B981',
  },
  lengthTextInvalid: {
    color: '#F59E0B',
  },
  registerButton: {
    width: '100%',
    height: 56,
    backgroundColor: 'transparent',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#4F46E5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#4F46E5',
  },
});
