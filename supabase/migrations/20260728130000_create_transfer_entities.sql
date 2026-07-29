/*
  المرحلة الثانية من وحدة "الجهات والشبكات" — التخزين فقط.

  - جدول transfer_entities لإدارة الجهات وشبكات التحويل الخاصة بكل مستخدم.
  - لا قواعد عمولات، ولا منطق تحويلات، ولا قيود أرباح وخسائر في هذه المرحلة.
  - الملكية عبر user_id → app_security(id) بنفس نمط جدول customers،
    وسياسات RLS متساهلة كسائر جداول المشروع (التقييد الفعلي من جهة العميل
    لأن التطبيق يعمل بمفتاح anon مع نظام دخول مخصص).
  - الحذف الفعلي مسموح في هذه المرحلة لأن لا شيء يشير إلى الجدول بعد؛
    المراحل القادمة ستربط قواعد العمولات به بـ ON DELETE RESTRICT فيصبح
    حذف جهة مستخدمة مرفوضاً تلقائياً.
*/

BEGIN;

CREATE TABLE IF NOT EXISTS public.transfer_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_security(id) ON DELETE CASCADE,
  name text NOT NULL,
  entity_type text NOT NULL DEFAULT 'entity' CHECK (entity_type IN ('entity', 'network')),
  phone text,
  address text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfer_entities_name_not_blank CHECK (length(trim(name)) > 0)
);

COMMENT ON TABLE public.transfer_entities IS
  'الجهات وشبكات التحويل الخاصة بكل مستخدم (وحدة الجهات والشبكات).';
COMMENT ON COLUMN public.transfer_entities.entity_type IS
  'entity = جهة، network = شبكة تحويل.';
COMMENT ON COLUMN public.transfer_entities.is_active IS
  'إيقاف الجهة يخفيها من الاختيارات المستقبلية دون حذف سجلها.';

-- منع تكرار الاسم لنفس المستخدم (بتجاهل حالة الأحرف والمسافات الطرفية)
CREATE UNIQUE INDEX IF NOT EXISTS uq_transfer_entities_user_name
  ON public.transfer_entities (user_id, lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_transfer_entities_user_active
  ON public.transfer_entities (user_id, is_active);

CREATE OR REPLACE FUNCTION public.set_transfer_entities_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfer_entities_updated_at ON public.transfer_entities;
CREATE TRIGGER trg_transfer_entities_updated_at
  BEFORE UPDATE ON public.transfer_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_transfer_entities_updated_at();

ALTER TABLE public.transfer_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to transfer entities" ON public.transfer_entities;
CREATE POLICY "Allow read access to transfer entities"
  ON public.transfer_entities FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "Allow insert access to transfer entities" ON public.transfer_entities;
CREATE POLICY "Allow insert access to transfer entities"
  ON public.transfer_entities FOR INSERT
  TO authenticated, anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow update access to transfer entities" ON public.transfer_entities;
CREATE POLICY "Allow update access to transfer entities"
  ON public.transfer_entities FOR UPDATE
  TO authenticated, anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow delete access to transfer entities" ON public.transfer_entities;
CREATE POLICY "Allow delete access to transfer entities"
  ON public.transfer_entities FOR DELETE
  TO authenticated, anon
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transfer_entities TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'transfer_entities_created' AS status;
