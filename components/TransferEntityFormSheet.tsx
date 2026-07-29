import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Building2, Save, Waypoints, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { TransferEntity } from '@/types/database';

interface TransferEntityFormSheetProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** null = إضافة جديدة، وإلا تعديل الجهة الممررة */
  entity?: TransferEntity | null;
}

export default function TransferEntityFormSheet({
  visible,
  onClose,
  onSaved,
  entity = null,
}: TransferEntityFormSheetProps) {
  const { currentUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [entityType, setEntityType] = useState<'entity' | 'network'>('entity');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isEditing = Boolean(entity?.id);

  useEffect(() => {
    if (visible) {
      setEntityType(entity?.entity_type === 'network' ? 'network' : 'entity');
      setName(entity?.name || '');
      setPhone(entity?.phone || '');
      setAddress(entity?.address || '');
      setNotes(entity?.notes || '');
    }
  }, [visible, entity]);

  const handleSave = async () => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      Alert.alert('خطأ', 'اسم الجهة أو الشبكة مطلوب');
      return;
    }

    if (!currentUser?.userId) {
      Alert.alert('خطأ', 'يجب تسجيل الدخول أولاً');
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        name: trimmedName,
        entity_type: entityType,
        phone: phone.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      };

      if (isEditing && entity) {
        const { error } = await supabase
          .from('transfer_entities')
          .update(payload)
          .eq('id', entity.id)
          .eq('user_id', currentUser.userId);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('transfer_entities').insert([
          {
            ...payload,
            user_id: currentUser.userId,
            is_active: true,
          },
        ]);

        if (error) throw error;
      }

      await Promise.resolve(onSaved());
      onClose();
    } catch (error: any) {
      if (error?.code === '23505') {
        Alert.alert('خطأ', 'يوجد جهة أو شبكة بنفس الاسم مسبقاً');
      } else {
        console.error('Error saving transfer entity:', error);
        Alert.alert('خطأ', 'حدث خطأ أثناء الحفظ');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetContainer}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(event) => event.stopPropagation()}
            style={styles.sheet}
          >
            <View style={styles.header}>
              <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                <X size={22} color="#6B7280" />
              </TouchableOpacity>

              <Text style={styles.headerTitle}>
                {isEditing ? 'تعديل جهة أو شبكة' : 'إضافة جهة أو شبكة'}
              </Text>

              <View style={{ width: 32 }} />
            </View>

            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  النوع <Text style={styles.required}>*</Text>
                </Text>

                <View style={styles.typeButtons}>
                  <TouchableOpacity
                    style={[styles.typeButton, entityType === 'entity' && styles.typeButtonActive]}
                    onPress={() => setEntityType('entity')}
                  >
                    <Building2
                      size={22}
                      color={entityType === 'entity' ? '#FFFFFF' : '#0EA5E9'}
                    />
                    <Text
                      style={[
                        styles.typeButtonText,
                        entityType === 'entity' && styles.typeButtonTextActive,
                      ]}
                    >
                      جهة
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.typeButton, entityType === 'network' && styles.typeButtonActive]}
                    onPress={() => setEntityType('network')}
                  >
                    <Waypoints
                      size={22}
                      color={entityType === 'network' ? '#FFFFFF' : '#0EA5E9'}
                    />
                    <Text
                      style={[
                        styles.typeButtonText,
                        entityType === 'network' && styles.typeButtonTextActive,
                      ]}
                    >
                      شبكة تحويل
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  الاسم <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="اسم الجهة أو الشبكة"
                  placeholderTextColor="#9CA3AF"
                  textAlign="right"
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>الهاتف</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="رقم الهاتف (اختياري)"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="phone-pad"
                  textAlign="right"
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>العنوان</Text>
                <TextInput
                  style={styles.input}
                  value={address}
                  onChangeText={setAddress}
                  placeholder="العنوان (اختياري)"
                  placeholderTextColor="#9CA3AF"
                  textAlign="right"
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>ملاحظات</Text>
                <TextInput
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="ملاحظات (اختياري)"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  textAlign="right"
                />
              </View>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <TouchableOpacity
                style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Save size={18} color="#FFFFFF" />
                    <Text style={styles.saveButtonText}>
                      {isEditing ? 'حفظ التعديلات' : 'إضافة'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    direction: 'rtl',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    height: '85%',
    direction: 'rtl',
  },
  sheet: {
    direction: 'rtl',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  closeButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    direction: 'rtl',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 104,
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    textAlign: 'right',
  },
  required: {
    color: '#EF4444',
  },
  typeButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  typeButton: {
    flex: 1,
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  typeButtonActive: {
    backgroundColor: '#0EA5E9',
    borderColor: '#0EA5E9',
  },
  typeButtonText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#111827',
    marginTop: 4,
  },
  typeButtonTextActive: {
    color: '#FFFFFF',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  notesInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  footer: {
    paddingHorizontal: 18,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  saveButton: {
    backgroundColor: '#0EA5E9',
    borderRadius: 12,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});
