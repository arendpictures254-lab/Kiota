-- AlterTable
ALTER TABLE "school_settings" ADD COLUMN     "meal_variance_percent" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "uniform_vote_head_id" UUID;

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "size" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "reorder_level_milli" INTEGER NOT NULL DEFAULT 0,
    "pack_name" TEXT,
    "pack_size_milli" INTEGER,
    "tracks_expiry" BOOLEAN NOT NULL DEFAULT false,
    "price_cents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "kra_pin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity_milli" INTEGER NOT NULL,
    "value_cents" INTEGER NOT NULL,
    "occurred_on" DATE NOT NULL,
    "supplier_id" UUID,
    "delivery_note" TEXT,
    "packs" INTEGER,
    "pack_size_milli" INTEGER,
    "expiry_date" DATE,
    "meal_issue_id" UUID,
    "uniform_issue_id" UUID,
    "stocktake_id" UUID,
    "transfer_id" UUID,
    "issued_to" TEXT,
    "reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ration_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "per_student_milli" INTEGER NOT NULL,

    CONSTRAINT "ration_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "students_served" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "served_confirmed" INTEGER,
    "confirmed_by_id" UUID,
    "confirmed_at" TIMESTAMPTZ(3),
    "variance_permille" INTEGER NOT NULL DEFAULT 0,
    "variance_status" TEXT NOT NULL DEFAULT 'none',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_issue_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "meal_issue_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "suggested_milli" INTEGER NOT NULL,
    "actual_milli" INTEGER NOT NULL,
    "cost_cents" INTEGER NOT NULL,
    "variance_permille" INTEGER,

    CONSTRAINT "meal_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uniform_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "payment" TEXT NOT NULL,
    "paid_reference" TEXT,
    "ledger_entry_id" UUID,
    "issued_by_id" UUID NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "returned_at" TIMESTAMPTZ(3),
    "returned_by_id" UUID,
    "return_reason" TEXT,
    "replaced_by_id" UUID,
    "reversal_entry_id" UUID,

    CONSTRAINT "uniform_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktakes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "started_by_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "note" TEXT,

    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "school_id" UUID NOT NULL,
    "stocktake_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "expected_milli" INTEGER,
    "counted_milli" INTEGER,
    "value_cents" INTEGER,

    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_school_id_name_key" ON "stores"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "stores_school_id_id_key" ON "stores"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "store_items_school_id_store_id_name_size_key" ON "store_items"("school_id", "store_id", "name", "size");

-- CreateIndex
CREATE UNIQUE INDEX "store_items_school_id_id_key" ON "store_items"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_school_id_name_key" ON "suppliers"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_school_id_id_key" ON "suppliers"("school_id", "id");

-- CreateIndex
CREATE INDEX "stock_movements_school_id_item_id_occurred_on_idx" ON "stock_movements"("school_id", "item_id", "occurred_on");

-- CreateIndex
CREATE INDEX "stock_movements_school_id_store_id_occurred_on_idx" ON "stock_movements"("school_id", "store_id", "occurred_on");

-- CreateIndex
CREATE INDEX "stock_movements_school_id_meal_issue_id_idx" ON "stock_movements"("school_id", "meal_issue_id");

-- CreateIndex
CREATE UNIQUE INDEX "meals_school_id_name_key" ON "meals"("school_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "meals_school_id_id_key" ON "meals"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ration_lines_school_id_meal_id_item_id_key" ON "ration_lines"("school_id", "meal_id", "item_id");

-- CreateIndex
CREATE INDEX "meal_issues_school_id_date_idx" ON "meal_issues"("school_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_issues_school_id_id_key" ON "meal_issues"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "meal_issue_lines_school_id_meal_issue_id_item_id_key" ON "meal_issue_lines"("school_id", "meal_issue_id", "item_id");

-- CreateIndex
CREATE INDEX "uniform_issues_school_id_student_id_idx" ON "uniform_issues"("school_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniform_issues_school_id_id_key" ON "uniform_issues"("school_id", "id");

-- CreateIndex
CREATE INDEX "stocktakes_school_id_store_id_idx" ON "stocktakes"("school_id", "store_id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktakes_school_id_id_key" ON "stocktakes"("school_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_school_id_stocktake_id_item_id_key" ON "stocktake_lines"("school_id", "stocktake_id", "item_id");

-- AddForeignKey
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_school_id_store_id_fkey" FOREIGN KEY ("school_id", "store_id") REFERENCES "stores"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_school_id_store_id_fkey" FOREIGN KEY ("school_id", "store_id") REFERENCES "stores"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_school_id_item_id_fkey" FOREIGN KEY ("school_id", "item_id") REFERENCES "store_items"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ration_lines" ADD CONSTRAINT "ration_lines_school_id_meal_id_fkey" FOREIGN KEY ("school_id", "meal_id") REFERENCES "meals"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_issues" ADD CONSTRAINT "meal_issues_school_id_meal_id_fkey" FOREIGN KEY ("school_id", "meal_id") REFERENCES "meals"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_issue_lines" ADD CONSTRAINT "meal_issue_lines_school_id_meal_issue_id_fkey" FOREIGN KEY ("school_id", "meal_issue_id") REFERENCES "meal_issues"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uniform_issues" ADD CONSTRAINT "uniform_issues_school_id_student_id_fkey" FOREIGN KEY ("school_id", "student_id") REFERENCES "students"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_school_id_stocktake_id_fkey" FOREIGN KEY ("school_id", "stocktake_id") REFERENCES "stocktakes"("school_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Written by hand: permissions, row-level security, append-only rules, defaults.
-- ===========================================================================

-- stores.manage is replaced by stores.view / receive / issue / adjust / setup / reports /
-- stocktake.approve and kitchen.confirm (the catalogue sync adds them to the roles).
DELETE FROM permission_grants WHERE permission_key = 'stores.manage';
DELETE FROM role_permissions WHERE permission_key = 'stores.manage';
DELETE FROM permissions WHERE key = 'stores.manage';

-- Anyone with a stores permission (or the cook) may read the school's stores.
CREATE FUNCTION app_can_see_stores() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN app_has_permission('stores.view') OR app_has_permission('stores.reports')
    OR app_has_permission('stores.setup') OR app_has_permission('stores.receive')
    OR app_has_permission('stores.issue') OR app_has_permission('stores.adjust')
    OR app_has_permission('stores.stocktake.approve') OR app_has_permission('kitchen.confirm');
END
$$;
-- Whoever may move stock (never the cook).
CREATE FUNCTION app_can_move_stock() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN app_has_permission('stores.receive') OR app_has_permission('stores.issue')
    OR app_has_permission('stores.adjust') OR app_has_permission('stores.stocktake.approve');
END
$$;
REVOKE ALL ON FUNCTION app_can_see_stores(), app_can_move_stock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_see_stores(), app_can_move_stock() TO kiota_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stores','store_items','suppliers','stock_movements','meals',
    'ration_lines','meal_issues','meal_issue_lines','uniform_issues','stocktakes','stocktake_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (school_id = (SELECT app_current_school()) '
      'AND (SELECT app_can_see_stores()))', t || '_select', t);
  END LOOP;

  -- Configuration: stores.setup.
  FOREACH t IN ARRAY ARRAY['stores','store_items','meals','ration_lines'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT WITH CHECK (school_id = (SELECT app_current_school()) '
      'AND (SELECT app_has_permission(%L)))', t || '_insert', t, 'stores.setup');
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE USING (school_id = (SELECT app_current_school()) '
      'AND (SELECT app_has_permission(%L))) '
      'WITH CHECK (school_id = (SELECT app_current_school()))', t || '_update', t, 'stores.setup');
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE ON stores, store_items, meals, ration_lines TO kiota_app;
GRANT DELETE ON ration_lines TO kiota_app;
CREATE POLICY ration_lines_delete ON ration_lines FOR DELETE
  USING (school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('stores.setup')));

-- Suppliers: set up, or added while receiving.
CREATE POLICY suppliers_insert ON suppliers FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('stores.setup')) OR (SELECT app_has_permission('stores.receive'))));
CREATE POLICY suppliers_update ON suppliers FOR UPDATE USING (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('stores.setup')) OR (SELECT app_has_permission('stores.receive'))))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON suppliers TO kiota_app;

-- The stock ledger: append-only, written only by people who may move stock (never the cook).
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school()) AND (SELECT app_can_move_stock()));
GRANT SELECT, INSERT ON stock_movements TO kiota_app;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION kiota_append_only();
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_kind CHECK (kind IN
  ('receive','issue','meal','transfer_out','transfer_in','adjust','stocktake','uniform_issue','uniform_return'));
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_quantity CHECK (quantity_milli <> 0);

-- Meal issues: the storekeeper records them; the cook may only confirm the number served, and
-- the Director or Principal only marks a variance reviewed (column privileges).
CREATE POLICY meal_issues_insert ON meal_issues FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('stores.issue')));
CREATE POLICY meal_issues_update ON meal_issues FOR UPDATE USING (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('kitchen.confirm')) OR (SELECT app_has_permission('stores.issue'))
       OR (SELECT app_has_permission('stores.stocktake.approve'))))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT ON meal_issues TO kiota_app;
GRANT UPDATE (served_confirmed, confirmed_by_id, confirmed_at, variance_status, reviewed_by_id,
  reviewed_at, review_note) ON meal_issues TO kiota_app;
CREATE POLICY meal_issue_lines_insert ON meal_issue_lines FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('stores.issue')));
GRANT SELECT, INSERT ON meal_issue_lines TO kiota_app;
CREATE TRIGGER meal_issue_lines_append_only BEFORE UPDATE OR DELETE ON meal_issue_lines
  FOR EACH ROW EXECUTE FUNCTION kiota_append_only();

-- Uniform issues: recorded by the storekeeper; only the return fields ever change.
CREATE POLICY uniform_issues_insert ON uniform_issues FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('stores.issue')));
CREATE POLICY uniform_issues_update ON uniform_issues FOR UPDATE USING (
  school_id = (SELECT app_current_school()) AND (SELECT app_has_permission('stores.issue')))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT ON uniform_issues TO kiota_app;
GRANT UPDATE (status, returned_at, returned_by_id, return_reason, replaced_by_id,
  reversal_entry_id) ON uniform_issues TO kiota_app;
ALTER TABLE uniform_issues ADD CONSTRAINT uniform_issues_payment CHECK (payment IN ('charged','paid_separately'));
ALTER TABLE uniform_issues ADD CONSTRAINT uniform_issues_quantity CHECK (quantity > 0);

-- Stock-takes: counted by the storekeeper, decided by the Director or Principal.
CREATE POLICY stocktakes_insert ON stocktakes FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('stores.adjust')) OR (SELECT app_has_permission('stores.issue'))));
CREATE POLICY stocktakes_update ON stocktakes FOR UPDATE USING (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('stores.adjust')) OR (SELECT app_has_permission('stores.issue'))
       OR (SELECT app_has_permission('stores.stocktake.approve'))))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON stocktakes TO kiota_app;
CREATE POLICY stocktake_lines_insert ON stocktake_lines FOR INSERT WITH CHECK (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('stores.adjust')) OR (SELECT app_has_permission('stores.issue'))));
CREATE POLICY stocktake_lines_update ON stocktake_lines FOR UPDATE USING (
  school_id = (SELECT app_current_school())
  AND ((SELECT app_has_permission('stores.adjust')) OR (SELECT app_has_permission('stores.issue'))))
  WITH CHECK (school_id = (SELECT app_current_school()));
GRANT SELECT, INSERT, UPDATE ON stocktake_lines TO kiota_app;
ALTER TABLE stocktakes ADD CONSTRAINT stocktakes_status CHECK (status IN ('counting','submitted','approved','rejected'));

-- Default stores and meals for every school (configuration: the school changes them).
CREATE FUNCTION kiota_store_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO stores (school_id, name, kind, position) VALUES
    (NEW.id, 'Food store', 'food', 1), (NEW.id, 'Uniform store', 'uniform', 2),
    (NEW.id, 'General store', 'general', 3), (NEW.id, 'Stationery', 'stationery', 4)
  ON CONFLICT (school_id, name) DO NOTHING;
  INSERT INTO meals (school_id, name, position) VALUES
    (NEW.id, 'Breakfast', 1), (NEW.id, 'Lunch', 2), (NEW.id, 'Supper', 3)
  ON CONFLICT (school_id, name) DO NOTHING;
  RETURN NEW;
END
$$;
CREATE TRIGGER schools_store_defaults AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION kiota_store_defaults();
INSERT INTO stores (school_id, name, kind, position)
SELECT s.id, d.name, d.kind, d.position FROM schools s
CROSS JOIN (VALUES ('Food store', 'food', 1), ('Uniform store', 'uniform', 2),
                   ('General store', 'general', 3), ('Stationery', 'stationery', 4)) AS d(name, kind, position)
ON CONFLICT (school_id, name) DO NOTHING;
INSERT INTO meals (school_id, name, position)
SELECT s.id, d.name, d.position FROM schools s
CROSS JOIN (VALUES ('Breakfast', 1), ('Lunch', 2), ('Supper', 3)) AS d(name, position)
ON CONFLICT (school_id, name) DO NOTHING;
