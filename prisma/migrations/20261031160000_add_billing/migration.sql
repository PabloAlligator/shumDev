-- Создаются только новые таблицы. Существующие данные/таблицы не меняются.
CREATE TABLE "BillingClient" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "projectName" TEXT,
    "note" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'MONTHLY',
    "startMonth" TEXT NOT NULL,
    "archivedFromMonth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "BillingPayment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "receivedOn" TEXT NOT NULL,
    "amountKopecks" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" INTEGER,
    "requestKey" TEXT,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BillingPayment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "BillingClient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "BillingPause" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "clientId" INTEGER NOT NULL,
    "fromMonth" TEXT NOT NULL,
    "toMonth" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillingPause_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "BillingClient" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BillingClient_archivedFromMonth_idx" ON "BillingClient"("archivedFromMonth");
CREATE INDEX "BillingClient_name_idx" ON "BillingClient"("name");
CREATE INDEX "BillingPayment_periodMonth_voidedAt_idx" ON "BillingPayment"("periodMonth", "voidedAt");
CREATE INDEX "BillingPayment_receivedOn_voidedAt_idx" ON "BillingPayment"("receivedOn", "voidedAt");
CREATE INDEX "BillingPayment_clientId_periodMonth_idx" ON "BillingPayment"("clientId", "periodMonth");
CREATE INDEX "BillingPause_clientId_fromMonth_idx" ON "BillingPause"("clientId", "fromMonth");
CREATE UNIQUE INDEX "BillingPayment_requestKey_key" ON "BillingPayment"("requestKey");
