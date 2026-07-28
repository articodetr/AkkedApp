/*
  اختبار نظام العمولات v2 — يُشغَّل يدوياً على قاعدة تطوير عبر SQL Editor
  أو psql بعد تطبيق 20260728100000_commission_system_v2.sql.

  السكربت كله داخل معاملة واحدة وينتهي بـ ROLLBACK — لا يترك أي أثر.
  أي فشل في تأكيد (ASSERT) يوقف التنفيذ برسالة واضحة.
  نجاح كامل = ظهور "ALL COMMISSION SYSTEM TESTS PASSED" ثم ROLLBACK.
*/

BEGIN;

DO $$
DECLARE
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_cust_plain uuid;        -- عميل غير مرتبط لدى A
  v_cust_linked uuid;       -- عميل مرتبط: دفتر A ← المستخدم B
  v_pl_a uuid;
  v_pl_b uuid;
  v_res jsonb;
  v_res2 jsonb;
  v_movement_id uuid;
  v_mirror_id uuid;
  v_pl_row_a uuid;
  v_pl_row_b uuid;
  v_op uuid;
  v_count integer;
  v_balance numeric;
  v_row record;
  v_approve jsonb;
  v_errored boolean;
BEGIN
  -- ---------------------------------------------------------------------
  -- تجهيز مستخدمين وعملاء للاختبار
  -- ---------------------------------------------------------------------
  INSERT INTO public.app_security (id, user_name, full_name, pin_hash, is_active, account_number)
  VALUES
    (v_user_a, 'test_comm_user_a', 'مستخدم أ', 'TEST_PIN_HASH', true, '90000001'),
    (v_user_b, 'test_comm_user_b', 'مستخدم ب', 'TEST_PIN_HASH', true, '90000002');

  -- حسابات الأرباح والخسائر (قد يكون التريغر أنشأها عند إدخال المستخدمين)
  v_pl_a := public.ensure_profit_loss_account_for_user(v_user_a);
  v_pl_b := public.ensure_profit_loss_account_for_user(v_user_b);
  ASSERT v_pl_a IS NOT NULL, 'لم يُنشأ حساب أرباح وخسائر للمستخدم أ';
  ASSERT v_pl_b IS NOT NULL, 'لم يُنشأ حساب أرباح وخسائر للمستخدم ب';
  ASSERT v_pl_a <> v_pl_b, 'حسابا الأرباح والخسائر يجب أن يكونا منفصلين';

  -- منع تكرار حساب الأرباح والخسائر
  v_errored := false;
  BEGIN
    INSERT INTO public.customers (name, phone, user_id, is_profit_loss_account)
    VALUES ('أرباح مكررة', 'DUP_PL_TEST', v_user_a, true);
  EXCEPTION WHEN unique_violation THEN
    v_errored := true;
  END;
  ASSERT v_errored, 'كان يجب رفض حساب أرباح وخسائر ثانٍ لنفس المستخدم';

  INSERT INTO public.customers (name, phone, user_id)
  VALUES ('عميل عادي', 'TEST_PLAIN_1', v_user_a)
  RETURNING id INTO v_cust_plain;

  INSERT INTO public.customers (name, phone, user_id, linked_user_id, account_number)
  VALUES ('حساب مرتبط ب', 'TEST_LINKED_1', v_user_a, v_user_b, '90000002')
  RETURNING id INTO v_cust_linked;

  -- =====================================================================
  -- القسم 1: حساب غير مرتبط
  -- =====================================================================

  -- 1.1 له 1000 بدون عمولة
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_plain, 'incoming', 1000, 'USD', 'اختبار له بدون عمولة');
  ASSERT (v_res->>'success')::boolean, '1.1 فشل الإنشاء';
  ASSERT (v_res->>'amount')::numeric = 1000, '1.1 المبلغ خاطئ';
  ASSERT v_res->>'approval_status' = 'approved', '1.1 يجب أن تكون معتمدة فوراً';
  ASSERT (v_res->>'profit_loss_movement_id') IS NULL, '1.1 لا يجب إنشاء قيد أرباح';

  -- 1.2 عليه 1000 بدون عمولة
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_plain, 'outgoing', 1000, 'USD', 'اختبار عليه بدون عمولة');
  ASSERT (v_res->>'movement_type') = 'outgoing', '1.2 الاتجاه خاطئ';

  -- الرصيد الآن 0 (1000 - 1000)
  SELECT COALESCE(SUM(CASE WHEN movement_type = 'incoming' THEN amount ELSE -amount END), 0)
    INTO v_balance
  FROM public.account_movements
  WHERE customer_id = v_cust_plain
    AND COALESCE(is_commission_movement, false) = false
    AND COALESCE(is_voided, false) = false;
  ASSERT v_balance = 0, format('1.2 الرصيد يجب أن يكون صفراً، وجد %s', v_balance);

  -- 1.3 له 1000 + عمولة 50 للعميل ⇒ العميل 1050 له، أرباح أ: عليه 50
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_plain, 'incoming', 1000, 'USD', 'اختبار عمولة للعميل',
    50, 'account_owner');
  ASSERT (v_res->>'amount')::numeric = 1050, '1.3 الإجمالي يجب أن يكون 1050';
  ASSERT (v_res->>'movement_type') = 'incoming', '1.3 الاتجاه خاطئ';
  v_pl_row_a := (v_res->>'profit_loss_movement_id')::uuid;
  ASSERT v_pl_row_a IS NOT NULL, '1.3 لم يُنشأ قيد الأرباح والخسائر';

  SELECT * INTO v_row FROM public.account_movements WHERE id = v_pl_row_a;
  ASSERT v_row.customer_id = v_pl_a, '1.3 القيد ليس على حساب أرباح أ';
  ASSERT v_row.movement_type = 'outgoing', '1.3 قيد الأرباح يجب أن يكون مصروفاً (عليه)';
  ASSERT v_row.amount = 50, '1.3 قيمة قيد الأرباح خاطئة';
  ASSERT v_row.is_commission_movement, '1.3 القيد يجب أن يكون معلماً كحركة عمولة';
  ASSERT v_row.related_commission_movement_id = (v_res->>'id')::uuid, '1.3 الربط بالحركة الأم مفقود';
  ASSERT v_row.approval_status = 'approved', '1.3 قيد غير مرتبط يجب أن يعتمد فوراً';

  -- 1.4 عليه 1000 + عمولة 50 لي ⇒ العميل 1050 عليه، أرباح أ: له 50
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_plain, 'outgoing', 1000, 'USD', 'اختبار عمولة لي',
    50, 'current_user');
  ASSERT (v_res->>'amount')::numeric = 1050, '1.4 الإجمالي يجب أن يكون 1050';
  ASSERT (v_res->>'movement_type') = 'outgoing', '1.4 الاتجاه خاطئ';
  SELECT * INTO v_row FROM public.account_movements
   WHERE id = (v_res->>'profit_loss_movement_id')::uuid;
  ASSERT v_row.movement_type = 'incoming', '1.4 قيد الأرباح يجب أن يكون ربحاً (له)';

  -- صافي أرباح أ الآن: -50 + 50 = 0
  SELECT COALESCE(SUM(CASE WHEN movement_type = 'incoming' THEN amount ELSE -amount END), 0)
    INTO v_balance
  FROM public.account_movements
  WHERE customer_id = v_pl_a AND COALESCE(is_voided, false) = false;
  ASSERT v_balance = 0, format('1.4 صافي الأرباح يجب أن يكون صفراً، وجد %s', v_balance);

  -- 1.5 رفض عمولة صفرية أو سالبة
  v_errored := false;
  BEGIN
    PERFORM public.create_movement_with_commission(
      'test_comm_user_a', v_cust_plain, 'incoming', 1000, 'USD', 'عمولة صفرية',
      0, 'current_user');
  EXCEPTION WHEN OTHERS THEN v_errored := true;
  END;
  ASSERT v_errored, '1.5 كان يجب رفض العمولة الصفرية';

  v_errored := false;
  BEGIN
    PERFORM public.create_movement_with_commission(
      'test_comm_user_a', v_cust_plain, 'incoming', 1000, 'USD', 'عمولة سالبة',
      -10, 'current_user');
  EXCEPTION WHEN OTHERS THEN v_errored := true;
  END;
  ASSERT v_errored, '1.5 كان يجب رفض العمولة السالبة';

  -- 1.6 رفض عمولة بلا صاحب / صاحب بلا عمولة
  v_errored := false;
  BEGIN
    PERFORM public.create_movement_with_commission(
      'test_comm_user_a', v_cust_plain, 'incoming', 1000, 'USD', 'عمولة بلا صاحب',
      50, NULL);
  EXCEPTION WHEN OTHERS THEN v_errored := true;
  END;
  ASSERT v_errored, '1.6 كان يجب رفض عمولة بلا صاحب';

  -- 1.7 رفض عمولة تعكس الاتجاه (متقاطعة أكبر من الأساس)
  v_errored := false;
  BEGIN
    PERFORM public.create_movement_with_commission(
      'test_comm_user_a', v_cust_plain, 'incoming', 100, 'USD', 'عمولة تعكس الاتجاه',
      150, 'current_user');
  EXCEPTION WHEN OTHERS THEN v_errored := true;
  END;
  ASSERT v_errored, '1.7 كان يجب رفض عمولة تعكس الاتجاه';

  -- 1.8 الذرية: لا قيد أرباح يتيماً ولا حركة ناقصة قيدها
  SELECT COUNT(*) INTO v_count
  FROM public.account_movements pl
  WHERE pl.is_commission_movement = true
    AND pl.customer_id IN (v_pl_a, v_pl_b)
    AND NOT EXISTS (
      SELECT 1 FROM public.account_movements parent
      WHERE parent.id = pl.related_commission_movement_id
    );
  ASSERT v_count = 0, '1.8 وجد قيد عمولة يتيم';

  SELECT COUNT(*) INTO v_count
  FROM public.account_movements m
  WHERE m.commission_amount IS NOT NULL
    AND COALESCE(m.is_commission_movement, false) = false
    AND m.customer_id IN (v_cust_plain)
    AND NOT EXISTS (
      SELECT 1 FROM public.account_movements pl
      WHERE pl.related_commission_movement_id = m.id
        AND pl.is_commission_movement = true
    );
  ASSERT v_count = 0, '1.8 وجدت حركة عمولة بلا قيد أرباح';

  -- 1.9 منع التكرار عبر مفتاح العملية
  v_op := gen_random_uuid();
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_plain, 'incoming', 200, 'USD', 'اختبار منع التكرار',
    10, 'current_user', v_op);
  ASSERT NOT (v_res->>'duplicate')::boolean, '1.9 الاستدعاء الأول ليس تكراراً';

  v_res2 := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_plain, 'incoming', 200, 'USD', 'اختبار منع التكرار',
    10, 'current_user', v_op);
  ASSERT (v_res2->>'duplicate')::boolean, '1.9 الاستدعاء الثاني يجب أن يُكتشف كتكرار';
  ASSERT (v_res2->>'id') = (v_res->>'id'), '1.9 يجب إرجاع نفس الحركة';

  SELECT COUNT(*) INTO v_count
  FROM public.account_movements
  WHERE operation_group_id = v_op AND customer_id = v_cust_plain;
  ASSERT v_count = 1, '1.9 يجب ألا تتكرر الحركة';

  RAISE NOTICE 'القسم 1 (حساب غير مرتبط): نجح';

  -- =====================================================================
  -- القسم 2: حساب مرتبط — العمولة للطرف الآخر
  -- له 1000 + عمولة 50 للعميل (المرتبط بالمستخدم ب)
  -- =====================================================================
  v_op := gen_random_uuid();
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_linked, 'incoming', 1000, 'USD', 'حوالة مرتبطة مع عمولة',
    50, 'account_owner', v_op);

  v_movement_id := (v_res->>'id')::uuid;
  v_mirror_id := (v_res->>'mirror_movement_id')::uuid;
  v_pl_row_a := (v_res->>'profit_loss_movement_id')::uuid;
  v_pl_row_b := (v_res->>'profit_loss_mirror_movement_id')::uuid;

  -- 2.1 أربعة قيود
  ASSERT v_movement_id IS NOT NULL AND v_mirror_id IS NOT NULL
     AND v_pl_row_a IS NOT NULL AND v_pl_row_b IS NOT NULL,
    '2.1 يجب إنشاء أربعة قيود';

  SELECT COUNT(*) INTO v_count
  FROM public.account_movements
  WHERE operation_group_id = v_op;
  ASSERT v_count = 4, format('2.1 عدد قيود العملية يجب أن يكون 4، وجد %s', v_count);

  -- 2.2 الاتجاهات والقيم
  SELECT * INTO v_row FROM public.account_movements WHERE id = v_movement_id;
  ASSERT v_row.movement_type = 'incoming' AND v_row.amount = 1050,
    '2.2 حركة المنشئ: له 1050';
  ASSERT v_row.base_amount = 1000 AND v_row.commission_amount = 50
     AND v_row.commission_owner = 'account_owner', '2.2 حقول العمولة على حركة المنشئ';

  SELECT * INTO v_row FROM public.account_movements WHERE id = v_mirror_id;
  ASSERT v_row.movement_type = 'outgoing' AND v_row.amount = 1050,
    '2.2 المرآة: عليه 1050';
  ASSERT v_row.commission_owner = 'current_user', '2.2 صاحب العمولة ينعكس على المرآة';
  ASSERT v_row.operation_group_id = v_op, '2.2 معرف العملية على المرآة';

  SELECT * INTO v_row FROM public.account_movements WHERE id = v_pl_row_a;
  ASSERT v_row.customer_id = v_pl_a AND v_row.movement_type = 'outgoing' AND v_row.amount = 50,
    '2.2 قيد أرباح أ: مصروف 50';

  SELECT * INTO v_row FROM public.account_movements WHERE id = v_pl_row_b;
  ASSERT v_row.customer_id = v_pl_b AND v_row.movement_type = 'incoming' AND v_row.amount = 50,
    '2.2 قيد أرباح ب: ربح 50';

  -- 2.3 كل القيود معلقة قبل الاعتماد
  SELECT COUNT(*) INTO v_count
  FROM public.account_movements
  WHERE operation_group_id = v_op
    AND public.get_movement_approval_status(approval_status, pending_approval) = 'pending';
  ASSERT v_count = 4, '2.3 كل القيود الأربعة يجب أن تكون معلقة';

  -- 2.4 المعلق لا يدخل الرصيد (عرض القائمة)
  SELECT COALESCE(SUM(balance), 0) INTO v_balance
  FROM public.customer_balances_by_currency
  WHERE customer_id = v_cust_linked;
  ASSERT v_balance = 0, '2.4 الحركة المعلقة يجب ألا تؤثر في الرصيد';

  SELECT COALESCE(SUM(balance), 0) INTO v_balance
  FROM public.customer_balances_by_currency
  WHERE customer_id = v_pl_b;
  ASSERT v_balance = 0, '2.4 قيد الأرباح المعلق يجب ألا يؤثر في أرباح ب';

  -- 2.5 المنشئ لا يعتمد حركته
  v_errored := false;
  BEGIN
    PERFORM public.approve_movement(v_movement_id, 'test_comm_user_a');
  EXCEPTION WHEN OTHERS THEN v_errored := true;
  END;
  ASSERT v_errored, '2.5 كان يجب منع المنشئ من اعتماد حركته';

  -- 2.6 اعتماد الطرف الآخر يعتمد القيود الأربعة معاً
  v_approve := public.approve_movement(v_movement_id, 'test_comm_user_b')::jsonb;
  ASSERT (v_approve->>'success')::boolean, '2.6 فشل الاعتماد';

  SELECT COUNT(*) INTO v_count
  FROM public.account_movements
  WHERE operation_group_id = v_op
    AND public.get_movement_approval_status(approval_status, pending_approval) = 'approved'
    AND COALESCE(is_voided, false) = false;
  ASSERT v_count = 4, '2.6 القيود الأربعة يجب أن تعتمد معاً';

  -- 2.7 الاعتماد المزدوج آمن (لا خطأ ولا تكرار)
  v_approve := public.approve_movement(v_movement_id, 'test_comm_user_b')::jsonb;
  ASSERT (v_approve->>'success')::boolean, '2.7 الاعتماد الثاني يجب ألا يفشل';
  SELECT COUNT(*) INTO v_count
  FROM public.account_movements WHERE operation_group_id = v_op;
  ASSERT v_count = 4, '2.7 يجب ألا تتكاثر القيود بعد اعتماد ثانٍ';

  -- 2.8 الأرصدة متساوية ومتعاكسة بعد الاعتماد
  SELECT COALESCE(SUM(balance), 0) INTO v_balance
  FROM public.customer_balances_by_currency WHERE customer_id = v_cust_linked;
  ASSERT v_balance = 1050, format('2.8 رصيد أ تجاه ب يجب أن يكون 1050، وجد %s', v_balance);

  SELECT COALESCE(SUM(CASE WHEN movement_type = 'incoming' THEN amount ELSE -amount END), 0)
    INTO v_balance
  FROM public.account_movements am
  JOIN public.customers c ON c.id = am.customer_id
  WHERE c.user_id = v_user_b AND c.linked_user_id = v_user_a
    AND COALESCE(am.is_commission_movement, false) = false
    AND COALESCE(am.is_voided, false) = false
    AND public.get_movement_approval_status(am.approval_status, am.pending_approval) = 'approved';
  ASSERT v_balance = -1050, format('2.8 رصيد ب تجاه أ يجب أن يكون -1050، وجد %s', v_balance);

  -- أرباح أ من هذه العملية: -50، أرباح ب: +50
  SELECT COALESCE(SUM(CASE WHEN movement_type = 'incoming' THEN amount ELSE -amount END), 0)
    INTO v_balance
  FROM public.account_movements
  WHERE customer_id = v_pl_b AND operation_group_id = v_op;
  ASSERT v_balance = 50, '2.8 صافي أرباح ب من العملية يجب أن يكون +50';

  RAISE NOTICE 'القسم 2 (مرتبط، العمولة للطرف الآخر): نجح';

  -- =====================================================================
  -- القسم 3: حساب مرتبط — العمولة لي، ثم رفض جماعي
  -- عليه 1000 + عمولة 50 لي
  -- =====================================================================
  v_op := gen_random_uuid();
  v_res := public.create_movement_with_commission(
    'test_comm_user_a', v_cust_linked, 'outgoing', 1000, 'USD', 'حوالة مرتبطة عمولتها لي',
    50, 'current_user', v_op);

  v_movement_id := (v_res->>'id')::uuid;
  v_pl_row_a := (v_res->>'profit_loss_movement_id')::uuid;

  SELECT * INTO v_row FROM public.account_movements WHERE id = v_movement_id;
  ASSERT v_row.movement_type = 'outgoing' AND v_row.amount = 1050, '3.1 عليه 1050';
  SELECT * INTO v_row FROM public.account_movements WHERE id = v_pl_row_a;
  ASSERT v_row.movement_type = 'incoming' AND v_row.amount = 50, '3.1 أرباح أ: ربح 50';
  SELECT * INTO v_row FROM public.account_movements
   WHERE id = (v_res->>'profit_loss_mirror_movement_id')::uuid;
  ASSERT v_row.movement_type = 'outgoing', '3.1 أرباح ب: مصروف 50';

  -- 3.2 الرفض يرفض القيود الأربعة معاً
  v_approve := public.reject_movement_with_reason(
    v_movement_id, 'test_comm_user_b', 'اختبار الرفض الجماعي')::jsonb;
  ASSERT (v_approve->>'success')::boolean, '3.2 فشل الرفض';

  SELECT COUNT(*) INTO v_count
  FROM public.account_movements
  WHERE operation_group_id = v_op
    AND approval_status = 'rejected'
    AND COALESCE(is_voided, false) = true;
  ASSERT v_count = 4, '3.2 القيود الأربعة يجب أن تُرفض وتُلغى معاً';

  -- 3.3 المرفوض لا يؤثر في أي رصيد
  SELECT COALESCE(SUM(balance), 0) INTO v_balance
  FROM public.customer_balances_by_currency WHERE customer_id = v_cust_linked;
  ASSERT v_balance = 1050, '3.3 رصيد العميل يجب أن يبقى 1050 (من القسم 2 فقط)';

  SELECT COALESCE(SUM(CASE WHEN movement_type = 'incoming' THEN amount ELSE -amount END), 0)
    INTO v_balance
  FROM public.account_movements
  WHERE customer_id = v_pl_a
    AND COALESCE(is_voided, false) = false
    AND public.get_movement_approval_status(approval_status, pending_approval) = 'approved';
  ASSERT v_balance = -50, '3.3 صافي أرباح أ يجب أن يكون -50 (القسم 2 فقط)';

  -- 3.4 لا يمكن اعتماد حركة مرفوضة
  v_errored := false;
  BEGIN
    PERFORM public.approve_movement(v_movement_id, 'test_comm_user_b');
  EXCEPTION WHEN OTHERS THEN v_errored := true;
  END;
  ASSERT v_errored, '3.4 كان يجب رفض اعتماد حركة مرفوضة';

  RAISE NOTICE 'القسم 3 (مرتبط، العمولة لي + الرفض الجماعي): نجح';

  RAISE NOTICE '=== ALL COMMISSION SYSTEM TESTS PASSED ===';
END $$;

ROLLBACK;
