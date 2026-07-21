import { useState, useEffect } from "react";
import {
  Customer,
  Product,
  ProductFeature,
  Supplier,
  Proforma,
  PurchaseOrder,
  Project,
  Transaction,
  Task,
  ModuleNotification,
  InventoryTransaction,
  ExchangeRate,
  ERPSettings,
  ProjectCategoryGroup,
  ProjectActivity,
  ProjectReferral,
  ProjectReferralResponse,
  User,
  PackingItem,
  DeliveryChecklistItem,
  PackagingDelivery,
  AfterSalesService,
  AuditLog,
  WorkflowRule,
  SupplierInquiry,
  SupplierInquiryItem,
  InquiryStep,
} from "./types";
import { compressLZW, decompressLZW } from "./utils/compress";

import {
  SEED_PRODUCTS,
  SEED_CUSTOMERS,
  SEED_SUPPLIERS,
  SEED_EXCHANGE_RATES,
  SEED_PROJECTS,
  SEED_PROFORMAS,
  SEED_PURCHASE_ORDERS,
  SEED_TRANSACTIONS,
  SEED_TASKS,
  DEFAULT_SETTINGS,
} from "./seedData";
import {
  toShamsiStr,
  getTodayShamsi,
  gregorianToJalali,
  addDaysToShamsi,
  addWorkingDaysToShamsi,
} from "./dateUtils";
import { formatERPNumber } from "./numUtils";

export const getProformaOutcomeStatus = (
  pf: Proforma,
):
  | "پیش‌نویس"
  | "ارسال شده"
  | "تأیید شده (برنده)"
  | "لغو شده"
  | "باخته"
  | "نیمه برنده"
  | "جاری" => {
  if (pf.isCancelled) return "لغو شده";

  const items = pf.items || [];
  if (items.length === 0) {
    if (pf.status === "پیش‌نویس") return "پیش‌نویس";
    return pf.status === "ارسال شده" ? "ارسال شده" : "جاری";
  }

  const wonCount = items.filter((i) => i.status === "برنده").length;
  const lostCount = items.filter((i) => i.status === "بازنده").length;
  const cancelledCount = items.filter((i) => i.status === "لغو شده").length;
  const totalCount = items.length;

  if (wonCount === totalCount) return "تأیید شده (برنده)";
  if (cancelledCount === totalCount) return "لغو شده";
  if (lostCount === totalCount) return "باخته";
  if (lostCount + cancelledCount === totalCount) {
    return cancelledCount > 0 ? "لغو شده" : "باخته";
  }

  if (wonCount > 0) return "نیمه برنده";

  if (pf.status === "پیش‌نویس") return "پیش‌نویس";
  if (pf.status === "ارسال شده") return "ارسال شده";
  return "جاری";
};

export const getWonItemsOfProforma = (pf: Proforma, includeOrder = false) => {
  const outcome = getProformaOutcomeStatus(pf);
  if (outcome !== "تأیید شده (برنده)" && outcome !== "نیمه برنده") return [];
  let wonItems = [];
  const hasExplicitWon = pf.items?.some((item) => item.status === "برنده");
  if (hasExplicitWon) {
    wonItems = pf.items.filter((item) => item.status === "برنده");
  } else {
    wonItems = pf.items?.filter((item) => item.status !== "بازنده") || [];
  }
  if (includeOrder) {
    return wonItems;
  }
  return wonItems.filter((item) => item.supplyMethod === "INVENTORY");
};

export const SEED_PROJECT_CATEGORY_GROUPS: ProjectCategoryGroup[] = [];

export const SEED_USERS: User[] = [
  {
    id: "user-1",
    username: "mohammad",
    password: "123",
    fullName: "محمد توکل مقدم",
    role: "admin",
    isSystemAdmin: true,
    permissions: {
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: true,
      tasks: true,
      referrals: true,
      settings: true,
      users: true,
      packagingDelivery: true,
    },
  },
  {
    id: "user-2",
    username: "antony",
    password: "123",
    fullName: "آنتونی فیرو",
    role: "user",
    isSystemAdmin: false,
    permissions: {
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: true,
      tasks: true,
      referrals: true,
      settings: false,
      users: false,
      packagingDelivery: true,
    },
  },
  {
    id: "user-3",
    username: "hosseini",
    password: "123",
    fullName: "مهندس حسینی",
    role: "user",
    isSystemAdmin: false,
    permissions: {
      dashboard: true,
      customers: true,
      projects: true,
      proformas: true,
      products: true,
      suppliers: true,
      purchaseOrders: true,
      transactions: true,
      tasks: true,
      referrals: true,
      settings: false,
      users: false,
      packagingDelivery: true,
    },
  },
];

export interface CompletionPrompt {
  projectId: string;
  categoryName: string;
  message: string;
}

const saveToServer = (key: string, data: any) => {
  fetch(`/api/data/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch((err) =>
    console.error(`Error saving to server for key: ${key}`, err),
  );
};

const faToEnDigits = (str: string): string => {
  const faDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let result = str;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(faDigits[i], 'g'), i.toString());
    result = result.replace(new RegExp(arDigits[i], 'g'), i.toString());
  }
  return result;
};

// Helper to parse delivery terms into days offset
const parseDeliveryPeriodToDays = (deliveryText: string): number => {
  if (!deliveryText) return 30; // default 30 days

  const text = deliveryText.trim().toLowerCase();

  // immediate (فوری)
  if (text.includes('فوری') || text.includes('fouri') || text.includes('فور')) {
    return 0;
  }

  const normalizedText = faToEnDigits(text);
  const match = normalizedText.match(/\d+/);

  if (!match) {
    if (normalizedText.includes('هفته')) return 7;
    if (normalizedText.includes('ماه')) return 30;
    if (normalizedText.includes('روز')) return 1;
    return 30; // default
  }

  const numberVal = parseInt(match[0], 10);

  if (normalizedText.includes('هفته')) {
    return numberVal * 7;
  }
  if (normalizedText.includes('ماه')) {
    return numberVal * 30;
  }
  if (normalizedText.includes('روز')) {
    return numberVal;
  }

  return numberVal; // If just a number
};

const syncProjectStatus = (projId: string, currentProformas: Proforma[], currentProjects: Project[]) => {
  if (!projId) return currentProjects;
  const projectProformas = currentProformas.filter(p => p.projectId === projId);
  if (projectProformas.length === 0) return currentProjects;

  // Find a won/approved/partially won proforma first
  let targetProforma = projectProformas.find(pf => {
    const outcome = getProformaOutcomeStatus(pf);
    return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
  });

  // If no won proforma, fall back to the latest proforma (sorted by timestamp in id, latest first)
  if (!targetProforma) {
    const sortedProformas = [...projectProformas].sort((a, b) => {
      const getTs = (id: string) => {
        const match = id.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };
      return getTs(b.id) - getTs(a.id);
    });
    targetProforma = sortedProformas[0];
  }

  let totalItems = 0;
  let wonItems = 0;
  let lostItems = 0;
  let pendingItems = 0;

  if (targetProforma && targetProforma.items) {
    targetProforma.items.forEach(item => {
      totalItems++;
      const itemStatus = item.status || 'جاری';
      if (itemStatus === 'برنده') {
        wonItems++;
      } else if (itemStatus === 'بازنده') {
        lostItems++;
      } else {
        pendingItems++;
      }
    });
  }

  // Determine project status
  const allCancelled = projectProformas.length > 0 && projectProformas.every(pf => getProformaOutcomeStatus(pf) === 'لغو شده');
  const allLost = projectProformas.length > 0 && projectProformas.every(pf => getProformaOutcomeStatus(pf) === 'باخته');

  let newStatus: Project['status'] = 'ارائه پیش‌فاکتور';
  if (allCancelled) {
    newStatus = 'لغو شده';
  } else if (allLost) {
    newStatus = 'باخته';
  } else if (totalItems > 0) {
    if (wonItems === totalItems) {
      newStatus = 'برنده (موفق)';
    } else if (lostItems === totalItems) {
      newStatus = 'باخته';
    } else if (wonItems > 0) {
      newStatus = 'نیمه برنده';
    } else {
      newStatus = 'ارائه پیش‌فاکتور';
    }
  }

  return currentProjects.map(p => {
    if (p.id === projId) {
      const today = getTodayShamsi();
      const updatedProject = { ...p, status: newStatus };

      if (newStatus === 'برنده (موفق)' || newStatus === 'نیمه برنده') {
        const wasWonBefore = p.status === 'برنده (موفق)' || p.status === 'نیمه برنده';

        if (!updatedProject.winningDate) {
          updatedProject.winningDate = today;
        }
        if (!updatedProject.closingDate) {
          updatedProject.closingDate = today;
        }

        // Try to find a won proforma for this project to calculate expected delivery date
        const wonPf = projectProformas.find(pf => {
          const outcome = getProformaOutcomeStatus(pf);
          return outcome === 'تأیید شده (برنده)' || outcome === 'نیمه برنده';
        });
        if (wonPf && wonPf.deliveryDate) {
          // Only set/overwrite if not set before, or if it was empty, or if we are newly transitioning to won
          if (!updatedProject.agreedDeliveryDate || !wasWonBefore) {
             const offsetDays = parseDeliveryPeriodToDays(wonPf.deliveryDate);
             const isWorkingDays = wonPf.deliveryDate.includes('کاری') || wonPf.deliveryDate.includes('کار') || wonPf.deliveryDate.toLowerCase().includes('work');
             const targetDate = isWorkingDays
               ? addWorkingDaysToShamsi(updatedProject.winningDate || today, offsetDays)
               : addDaysToShamsi(updatedProject.winningDate || today, offsetDays);
             updatedProject.agreedDeliveryDate = targetDate;
          }
        } else {
          // Default fallback if no won proforma with deliveryDate
          if (!updatedProject.agreedDeliveryDate) {
            updatedProject.agreedDeliveryDate = today;
          }
        }
      } else if (newStatus === 'باخته' || newStatus === 'لغو شده') {
        if (!updatedProject.closingDate) {
          updatedProject.closingDate = today;
        }
      }
      return updatedProject;
    }
    return p;
  });
};

export function useERPStore() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [inventoryTransactions, setInventoryTransactions] = useState<
    InventoryTransaction[]
  >([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [packagingDeliveries, setPackagingDeliveries] = useState<
    PackagingDelivery[]
  >([]);
  const [afterSalesServices, setAfterSalesServices] = useState<
    AfterSalesService[]
  >([]);
  const [supplierInquiries, setSupplierInquiries] = useState<SupplierInquiry[]>(
    [],
  );
  const [moduleNotifications, setModuleNotifications] = useState<
    ModuleNotification[]
  >([]);
  const [projectCategoryGroups, setProjectCategoryGroups] = useState<
    ProjectCategoryGroup[]
  >([]);
  const [readItems, setReadItems] = useState<string[]>([]);
  const [settings, setSettings] = useState<ERPSettings>(DEFAULT_SETTINGS);
  const [isInitialized, setIsInitialized] = useState(false);

  const [users, setUsers] = useState<User[]>([]);

  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Function to log actions with LZW compressed state changes
  const logAction = (
    action: "CREATE" | "UPDATE" | "DELETE" | "LOGIN" | "LOGOUT",
    module: string,
    entityId: string,
    description: string,
    before?: any,
    after?: any,
  ) => {
    const nowJalali =
      getTodayShamsi() +
      " " +
      new Date().toLocaleTimeString("fa-IR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    const beforeState = before
      ? compressLZW(JSON.stringify(before))
      : undefined;
    const afterState = after ? compressLZW(JSON.stringify(after)) : undefined;

    const newLog: AuditLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: nowJalali,
      userId: currentUser?.id || "system",
      userFullName: currentUser?.fullName || "کاربر سیستم",
      action,
      module,
      entityId,
      description,
      beforeState,
      afterState,
    };

    setAuditLogs((prev) => {
      const updated = [newLog, ...prev];
      const truncated = updated.slice(0, 1000);
      saveToServer("erp_audit_logs", truncated);
      return truncated;
    });
  };

  const [completionPrompt, setCompletionPrompt] = useState<{
    projectId: string;
    categoryName: string;
    message: string;
  } | null>(null);

  // completeCategoryGroup is defined below to prevent TDZ with updateProject


  useEffect(() => {
    if (currentUser) {
      try {
        const storedReadNotifs = localStorage.getItem(
          `read_notifications_${currentUser.id}`,
        );
        if (storedReadNotifs) {
          setReadItems(JSON.parse(storedReadNotifs));
        } else {
          setReadItems([]);
        }
      } catch (e) {
        console.error(
          "Failed to parse read notifications from localStorage",
          e,
        );
        setReadItems([]);
      }
    } else {
      setReadItems([]);
    }
  }, [currentUser]);

  // Simulated User Role state ('admin' = Manager/Administrator, 'user' = Standard Employee/Expert)
  const [userRole, setUserRole] = useState<"admin" | "user">(() => {
    try {
      const saved = localStorage.getItem("erp_simulated_role");
      return saved === "user" ? "user" : "admin";
    } catch (e) {
      return "admin";
    }
  });

  const changeRole = (role: "admin" | "user") => {
    setUserRole(role);
    try {
      localStorage.setItem("erp_simulated_role", role);
    } catch (e) {}
  };

  // Initialize store from server
  useEffect(() => {
    async function loadData() {
      try {
        let batchLoaded = false;
        try {
          const res = await fetch("/api/init-data");
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data === "object") {
              if (data.erp_customers !== null)
                setCustomers(data.erp_customers || []);
              if (data.erp_products !== null)
                setProducts(data.erp_products || []);
              if (data.erp_suppliers !== null)
                setSuppliers(data.erp_suppliers || []);
              if (data.erp_exchange_rates !== null)
                setExchangeRates(data.erp_exchange_rates || []);
              if (data.erp_projects !== null)
                setProjects(data.erp_projects || []);
              if (data.erp_proformas !== null)
                setProformas(data.erp_proformas || []);
              if (data.erp_purchase_orders !== null)
                setPurchaseOrders(data.erp_purchase_orders || []);
              if (data.erp_transactions !== null)
                setTransactions(data.erp_transactions || []);
              if (data.erp_inventory_transactions !== null)
                setInventoryTransactions(data.erp_inventory_transactions || []);
              if (data.erp_tasks !== null) setTasks(data.erp_tasks || []);
              if (data.erp_settings !== null)
                setSettings(data.erp_settings || DEFAULT_SETTINGS);
              if (data.erp_project_category_groups !== null)
                setProjectCategoryGroups(
                  data.erp_project_category_groups || [],
                );
              if (data.erp_packaging_deliveries !== null)
                setPackagingDeliveries(data.erp_packaging_deliveries || []);
              if (data.erp_after_sales_services !== null)
                setAfterSalesServices(data.erp_after_sales_services || []);
              if (data.erp_supplier_inquiries !== null)
                setSupplierInquiries(data.erp_supplier_inquiries || []);
              if (data.erp_users !== null) setUsers(data.erp_users || []);
              if (data.erp_audit_logs !== null)
                setAuditLogs(data.erp_audit_logs || []);
              batchLoaded = true;
            }
          }
        } catch (batchErr) {
          console.warn(
            "Failed to batch fetch initial data, falling back to sequential/individual requests...",
            batchErr,
          );
        }

        if (!batchLoaded) {
          const fetchKey = async (
            key: string,
            setter: Function,
            fallback: any,
          ) => {
            try {
              const res = await fetch(`/api/data/${key}`);
              if (res.ok) {
                const data = await res.json();
                if (data !== null) {
                  setter(data);
                } else {
                  setter(fallback);
                }
              } else {
                setter(fallback);
              }
            } catch (e) {
              console.error(`Failed to fetch ${key}:`, e);
              setter(fallback);
            }
          };

          await Promise.all([
            fetchKey("erp_customers", setCustomers, []),
            fetchKey("erp_products", setProducts, []),
            fetchKey("erp_suppliers", setSuppliers, []),
            fetchKey("erp_exchange_rates", setExchangeRates, []),
            fetchKey("erp_projects", setProjects, []),
            fetchKey("erp_proformas", setProformas, []),
            fetchKey("erp_purchase_orders", setPurchaseOrders, []),
            fetchKey("erp_transactions", setTransactions, []),
            fetchKey(
              "erp_inventory_transactions",
              setInventoryTransactions,
              [],
            ),
            fetchKey("erp_tasks", setTasks, []),
            fetchKey("erp_settings", setSettings, DEFAULT_SETTINGS),
            fetchKey(
              "erp_project_category_groups",
              setProjectCategoryGroups,
              [],
            ),
            fetchKey("erp_packaging_deliveries", setPackagingDeliveries, []),
            fetchKey("erp_after_sales_services", setAfterSalesServices, []),
            fetchKey("erp_supplier_inquiries", setSupplierInquiries, []),
            fetchKey("erp_users", setUsers, []),
            fetchKey("erp_audit_logs", setAuditLogs, []),
          ]);
        }

        const storedCurrentUser = localStorage.getItem("erp_current_user");
        if (storedCurrentUser) {
          try {
            const u = JSON.parse(storedCurrentUser);
            setCurrentUser(u);
            if (u && u.role) {
              setUserRole(u.role);
            }
          } catch (e) {}
        }
        setIsInitialized(true);
      } catch (err) {
        console.error("Failed to load initial data", err);
        setIsInitialized(true);
      }
    }
    loadData();
  }, []);

  const fetchRatesFromAPI = async (silent = false) => {
    try {
      const response = await fetch("/api/rates");
      if (!response.ok) throw new Error("API response not ok");
      const data = await response.json();
      if (data && data.success && data.rates) {
        setExchangeRates((currentRates) => {
          const updated = currentRates.map((r) => {
            const val = data.rates[r.currency];
            if (val) {
              return {
                ...r,
                rateToRIYAL: val,
                lastUpdated: new Date().toISOString(),
              };
            }
            return r;
          });
          saveToServer("erp_exchange_rates", updated);
          return updated;
        });
        console.log("Exchange rates updated from tgju.com successfully!");

        if (
          data.hasErrors ||
          (data.failedCurrencies && data.failedCurrencies.length > 0)
        ) {
          if (
            silent &&
            (currentUser?.role === "admin" || currentUser?.isSystemAdmin)
          ) {
            alert(
              "در بروزرسانی خودکار نرخ برخی ارزها خطایی رخ داد. لطفا بررسی کنید یا مقادیر را دستی ثبت کنید.",
            );
          }
          return false; // Return false if there were some errors so manual click shows failure alert
        }

        return true;
      }
    } catch (err) {
      console.warn("Failed to auto-fetch exchange rates from tgju:", err);
      if (
        silent &&
        (currentUser?.role === "admin" || currentUser?.isSystemAdmin)
      ) {
        alert(
          "خطا در ارتباط با سرور برای بروزرسانی نرخ ارز. لطفا قیمت را دستی ثبت کنید.",
        );
      }
    }
    return false;
  };

  // Auto-fetch exchange rates on startup once initialized from tgju.com API, and daily at 14:00
  useEffect(() => {
    if (isInitialized) {
      fetchRatesFromAPI(true);

      const interval = setInterval(() => {
        const now = new Date();
        if (now.getHours() === 14 && now.getMinutes() === 0) {
          fetchRatesFromAPI(true);
        }
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [isInitialized]);

  // Save changes helper
  const saveToStorage = (key: string, data: any, stateSetter: Function) => {
    try {
      stateSetter(data);
      if (key === "erp_current_user") {
        localStorage.setItem(key, JSON.stringify(data));
      } else {
        saveToServer(key, data);
      }
    } catch (error) {
      console.error(`Error saving storage for key: ${key}`, error);
    }
  };

  const autoLogFactActivity = (projectId: string | undefined, categoryName: string, text: string, sourceId?: string) => {
    if (!projectId) return;

    // A helper to normalize and map different variations of categories to formal standard ones
    const getMappedCategoryName = (name: string): string => {
      const norm = (str: string) => str ? str.replace(/[\s\u200c]/g, "").trim().toLowerCase() : "";
      const n = norm(name);
      if (n === norm('پیش‌فاکتور') || n === norm('پیش‌فاکتورها') || n === norm('پیش‌فاکتورها و مهندسی فروش')) {
        return 'پیش‌فاکتورها و مهندسی فروش';
      }
      if (n === norm('سفارش خرید') || n === norm('سفارشات خرید تامین‌کنندگان') || n === norm('سفارشات خرید تامین کنندگان')) {
        return 'سفارشات خرید تامین‌کنندگان';
      }
      if (n === norm('استعلام قیمت از تامین‌کننده‌ها') || n === norm('استعلام قیمت تأمین‌کنندگان') || n === norm('استعلام قیمت تامین کنندگان')) {
        return 'استعلام قیمت تأمین‌کنندگان';
      }
      if (n === norm('مالی') || n === norm('تراکنش‌های مالی و پرداخت‌ها') || n === norm('تراکنش های مالی و پرداخت ها')) {
        return 'تراکنش‌های مالی و پرداخت‌ها';
      }
      return name;
    };

    const finalCategoryName = getMappedCategoryName(categoryName);
    const normalize = (str: string) => str ? str.replace(/[\s\u200c]/g, "").trim().toLowerCase() : "";

    setProjectCategoryGroups((prevGroups: any[]) => {
      let updatedGroups = [...prevGroups];
      const existingGroupIndex = updatedGroups.findIndex(g => 
        g.projectId === projectId && 
        normalize(g.categoryName) === normalize(finalCategoryName)
      );

      const newActivity = {
        id: 'act-' + Date.now() + Math.random().toString(36).substr(2, 5),
        text,
        sourceId: sourceId || null,
        createdAt: new Date().toISOString(),
        attachment: null,
        referral: null,
        createdBy: currentUser?.fullName || "کاربر سیستم"
      };

      if (existingGroupIndex >= 0) {
        const group = updatedGroups[existingGroupIndex];
        updatedGroups[existingGroupIndex] = {
          ...group,
          activities: [...(group.activities || []), newActivity]
        };
      } else {
        const newGroup = {
          id: `catgrp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          projectId: projectId,
          categoryId: `cat-fact-${Date.now()}`,
          categoryName: finalCategoryName,
          status: 'جاری',
          activities: [newActivity],
          createdAt: new Date().toISOString(),
          startDate: getTodayShamsi()
        };
        updatedGroups.push(newGroup);
      }
      
      try {
        saveToServer("erp_project_category_groups", updatedGroups);
      } catch (err) {}
      
      return updatedGroups;
    });
  };

  // Removes auto-logged fact activities belonging to a deleted source record and prunes the
  // category group if it becomes empty. New activities are matched exactly by their stored
  // `sourceId`; activities logged before source linking existed fall back to legacy text matching.
  const removeFactActivitiesForRecord = (
    projectId: string | undefined,
    categoryName: string,
    sourceId: string | undefined,
    matchesLegacyText: (text: string) => boolean
  ) => {
    if (!projectId) return;
    const normalizeCategory = (str: string) => str ? str.replace(/[\s‌]/g, "").trim().toLowerCase() : "";
    const isTargetGroup = (g: any) =>
      g.projectId === projectId && normalizeCategory(g.categoryName) === normalizeCategory(categoryName);
    const shouldRemove = (act: any) => {
      // Activity carries an explicit source link → trust it exactly (never over-delete siblings).
      if (act.sourceId) return act.sourceId === sourceId;
      // Legacy activity without a source link → best-effort text match.
      return matchesLegacyText(act.text || '');
    };
    const updatedGroups = projectCategoryGroups
      .map(g => isTargetGroup(g)
        ? { ...g, activities: (g.activities || []).filter((act: any) => !shouldRemove(act)) }
        : g)
      .filter(g => !isTargetGroup(g) || (g.activities || []).length > 0);
    saveToStorage("erp_project_category_groups", updatedGroups, setProjectCategoryGroups);
  };

  // --- Customers CRUD ---
  const addCustomer = (customer: Omit<Customer, "id">) => {
    const newId = `cust-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const newCustomer: Customer = { createdAt: new Date().toISOString(),
      ...customer,
      id: newId,
      
    };
    setCustomers((prev) => {
      let updated = prev.map((c) => {
        if (newCustomer.linkedCustomerIds?.includes(c.id)) {
          const currentLinks = c.linkedCustomerIds || [];
          if (!currentLinks.includes(newId)) {
            return {
              ...c,
              linkedCustomerIds: [...currentLinks, newId],
            };
          }
        }
        return c;
      });
      updated = [newCustomer, ...updated];
      saveToServer("erp_customers", updated);
      logAction(
        "CREATE",
        "مشتریان",
        newCustomer.id,
        `ایجاد مشتری جدید: ${newCustomer.companyName || `${newCustomer.firstName || ""} ${newCustomer.lastName || ""}`.trim()}`,
        undefined,
        newCustomer,
      );
      return updated;
    });
    processWorkflowRules('customer_created', newCustomer);
    return newCustomer;
  };

  const updateCustomer = (updatedCust: Customer) => {
    const before = customers.find((c) => c.id === updatedCust.id);
    setCustomers((prev) => {
      const updated = prev.map((c) =>
        c.id === updatedCust.id ? updatedCust : c,
      );
      saveToServer("erp_customers", updated);
      logAction(
        "UPDATE",
        "مشتریان",
        updatedCust.id,
        `ویرایش اطلاعات مشتری: ${updatedCust.companyName || `${updatedCust.firstName || ""} ${updatedCust.lastName || ""}`.trim()}`,
        before,
        updatedCust,
      );
      return updated;
    });
    processWorkflowRules('customer_updated', {
      ...updatedCust,
      oldCity: before?.city,
      oldType: before?.customerType,
      newStatus: updatedCust.customerType,
    });
  };

  const deleteCustomer = (id: string) => {
    setCustomers((prev) => {
      const before = prev.find((c) => c.id === id);
      const updated = prev.filter((c) => c.id !== id);
      saveToServer("erp_customers", updated);
      if (before) {
        logAction(
          "DELETE",
          "مشتریان",
          id,
          `حذف مشتری: ${before.companyName || `${before.firstName || ""} ${before.lastName || ""}`.trim()}`,
          before,
          undefined,
        );
      }
      return updated;
    });
  };

  const batchUpdateCustomers = (updatedList: Customer[]) => {
    saveToStorage("erp_customers", updatedList, setCustomers);
  };

  // --- Products & Stock CRUD ---
  const addProduct = (
    product: Omit<Product, "id" | "stockLevel"> & {
      stockLevel?: number;
      transactionDate?: string;
    },
  ) => {
    let finalCode = product.code;
    const isAutoGenerated = !finalCode || finalCode.startsWith("EQ-");
    if (isAutoGenerated) {
      const seqNum = (settings.documentFormats.productStartSeq || 1) + products.length;
      finalCode = formatERPNumber(
        settings.documentFormats.productFormat || "EQ-{RAND:5}",
        {
          seq: seqNum,
          category: product.category,
        },
      );
    }
    const newProduct: Product = {
      ...product,
      code: finalCode,
      id: `prod-${Date.now()}`,
      stockLevel: product.stockLevel || 0,
    };

    // Auto-generate SKUs for variants if missing
    if (newProduct.hasVariants && newProduct.variants) {
      newProduct.variants = newProduct.variants.map((v, i) => ({
        ...v,
        sku: v.sku || `${finalCode}-${i + 1}`,
        id: v.id || `var-${Date.now()}-${i}`,
      }));
    }

    const updated = [newProduct, ...products];
    saveToStorage("erp_products", updated, setProducts);
    processWorkflowRules('product_created', newProduct);

    // Add initial stock transactions if any
    if (!newProduct.hasVariants && newProduct.stockLevel > 0) {
      const initTx: InventoryTransaction = {
        id: `inv-tr-${Date.now()}`,
        productId: newProduct.id,
        date: product.transactionDate || new Date().toISOString(),
        type: "IN",
        quantity: newProduct.stockLevel,
        referenceType: "MANUAL",
        notes: "موجودی اولیه",
      };
      saveToStorage(
        "erp_inventory_transactions",
        [initTx, ...inventoryTransactions],
        setInventoryTransactions,
      );
    } else if (newProduct.hasVariants && newProduct.variants) {
      const initTxs: InventoryTransaction[] = [];
      newProduct.variants.forEach((v, i) => {
        if (v.stockLevel > 0) {
          initTxs.push({
            id: `inv-tr-${Date.now()}-${i}`,
            productId: newProduct.id,
            variantId: v.id,
            date: product.transactionDate || new Date().toISOString(),
            type: "IN",
            quantity: v.stockLevel,
            referenceType: "MANUAL",
            notes: "موجودی اولیه SKU",
          });
        }
      });
      if (initTxs.length > 0) {
        saveToStorage(
          "erp_inventory_transactions",
          [...initTxs, ...inventoryTransactions],
          setInventoryTransactions,
        );
      }
    }

    logAction(
      "CREATE",
      "کالاها",
      newProduct.id,
      `ایجاد کالای جدید: ${newProduct.name} (کد: ${newProduct.code})`,
      undefined,
      newProduct,
    );
    return newProduct;
  };

  const updateProduct = (updatedProd: Product) => {
    const before = products.find((p) => p.id === updatedProd.id);

    // Auto-generate SKUs for variants if missing
    if (updatedProd.hasVariants && updatedProd.variants) {
      updatedProd.variants = updatedProd.variants.map((v, i) => ({
        ...v,
        sku: v.sku || `${updatedProd.code}-${i + 1}`,
        id: v.id || `var-${Date.now()}-${i}`,
      }));
    }

    const updated = products.map((p) =>
      p.id === updatedProd.id ? updatedProd : p,
    );
    saveToStorage("erp_products", updated, setProducts);
    logAction(
      "UPDATE",
      "کالاها",
      updatedProd.id,
      `ویرایش اطلاعات کالا: ${updatedProd.name} (کد: ${updatedProd.code})`,
      before,
      updatedProd,
    );
  };

  const deleteProduct = (id: string) => {
    const before = products.find((p) => p.id === id);
    const updated = products.filter((p) => p.id !== id);
    saveToStorage("erp_products", updated, setProducts);
    if (before) {
      logAction(
        "DELETE",
        "کالاها",
        id,
        `حذف کالا: ${before.name} (کد: ${before.code})`,
        before,
        undefined,
      );
    }
  };

  const batchImportProducts = (items: any[]) => {
    let successCount = 0;
    let createCount = 0;
    const newTransactions: InventoryTransaction[] = [];
    const nowStr = new Date().toISOString();

    setProducts((prev) => {
      let currentProducts = [...prev];

      items.forEach((item, index) => {
        const code = item.code;
        const name = item.name;
        const displayName = item.displayName || item.name;
        const category = item.category || "بدون دسته‌بندی";
        const brand = item.brand || "";
        const supplyType =
          item.supplyType === "INVENTORY" ? "INVENTORY" : "ORDER";
        const amt = Number(item.amount) || Number(item.amt) || 0;
        const type = item.type;
        const dateVal = item.date || item.dateVal;
        const notes = item.notes || "";
        const priceForeign = item.priceForeign;
        const currencyForeign = item.currencyForeign;
        const priceRIYAL = item.priceRIYAL;

        const extractNameAndCode = (str: string) => {
          const match = str.trim().match(/^([^[({]+?)(?:\s*[[({\s]\s*([^\])}]+?)\s*[\])}]+)?$/);
          if (match) {
            const name = match[1].trim();
            const code = match[2] ? match[2].trim() : undefined;
            return { name, code };
          }
          return { name: str.trim(), code: undefined };
        };

        const parseFeatures = (raw?: string) => {
          if (!raw || typeof raw !== "string") return [];
          const parsedFeatures: ProductFeature[] = [];
          const parts = raw.split("|");
          parts.forEach((part, fIdx) => {
            const [fRaw, fOptsRaw] = part.split(":");
            if (fRaw && fOptsRaw) {
              const { name: fName, code: fCode } = extractNameAndCode(fRaw);
              const options = fOptsRaw
                .split(/[,،]/)
                .map((o) => o.trim())
                .filter(Boolean);
              if (options.length > 0) {
                parsedFeatures.push({
                  id: `feat-${Date.now()}-${fIdx}-${Math.random().toString(36).substr(2, 5)}`,
                  name: fName,
                  code: fCode,
                  options: options.map((o, oIdx) => {
                    return {
                      id: `opt-${Date.now()}-${oIdx}-${Math.random().toString(36).substr(2, 5)}`,
                      value: o,
                    };
                  }),
                });
              }
            }
          });
          return parsedFeatures;
        };
        const features = parseFeatures(item.featuresRaw);

        // Try to find existing product if code is provided
        let prodIndex = -1;
        let variantId;
        if (code) {
          prodIndex = currentProducts.findIndex((p) => p.code === code);
          if (prodIndex === -1) {
            // Check if code matches a variant SKU
            prodIndex = currentProducts.findIndex(p => p.hasVariants && p.variants && p.variants.some(v => v.sku === code));
            if (prodIndex >= 0) {
              const v = currentProducts[prodIndex].variants.find(v => v.sku === code);
              if (v) variantId = v.id;
            }
          }
        }

        if (code && prodIndex >= 0) {
          // UPDATE EXISTING PRODUCT
          const product = currentProducts[prodIndex];
          let isUpdated = false;
          let beforeStock = product.stockLevel || 0;
          let afterStock = product.stockLevel || 0;
          let updatedVariants = product.variants ? [...product.variants] : [];
          let updatedProduct = { ...product };

          // 1. Update general fields on product if present in row
          if (name && name !== product.name) {
            updatedProduct.name = name;
            updatedProduct.displayName = name;
            isUpdated = true;
          }
          if (category && category !== product.category) {
            updatedProduct.category = category;
            isUpdated = true;
          }
          if (brand && brand !== product.brand) {
            updatedProduct.brand = brand;
            isUpdated = true;
          }
          if (supplyType && supplyType !== product.supplyType) {
            updatedProduct.supplyType = supplyType;
            isUpdated = true;
          }

          // Update features & variants if features are provided in the Excel row
          if (features && features.length > 0) {
            const featuresChanged = JSON.stringify(features) !== JSON.stringify(product.features);
            if (featuresChanged) {
              updatedProduct.features = features;
              updatedProduct.hasVariants = true;
              
              const getCombinations = (featuresArr: any[]): any[] => {
                if (featuresArr.length === 0) return [{}];
                const current = featuresArr[0];
                const rest = getCombinations(featuresArr.slice(1));
                const combos: any[] = [];
                if (current.options.length === 0) return rest;
                for (const opt of current.options) {
                  for (const r of rest) {
                    combos.push({ ...r, [current.name]: opt.value });
                  }
                }
                return combos;
              };
              const combinations = getCombinations(features);
              const pCode = updatedProduct.code;
              
              const newVariants = combinations.map((combo, i) => {
                const skuParts = [pCode];
                features.forEach((feat) => {
                  const fVal = combo[feat.name];
                  if (fVal) {
                    const optIndex = feat.options.findIndex(o => o.value === fVal);
                    if (optIndex !== -1) {
                      const prefix = feat.code ? feat.code : '';
                      skuParts.push(`${prefix}${optIndex + 1}`);
                    }
                  }
                });
                
                const existingMatch = product.variants?.find((ev: any) => {
                  return Object.entries(combo).every(([k, v]) => ev.attributes?.[k] === v);
                });

                return {
                  id: existingMatch?.id || `var-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                  sku: skuParts.join('-'),
                  attributes: combo,
                  stockLevel: existingMatch?.stockLevel || 0,
                  minStockLevel: existingMatch?.minStockLevel || 0,
                  priceForeign: existingMatch?.priceForeign !== undefined ? existingMatch.priceForeign : (priceForeign !== undefined ? Number(priceForeign) : undefined),
                  currencyForeign: existingMatch?.currencyForeign || currencyForeign || undefined,
                  priceRIYAL: existingMatch?.priceRIYAL !== undefined ? existingMatch.priceRIYAL : (priceRIYAL !== undefined ? Number(priceRIYAL) : undefined)
                };
              });

              updatedVariants = newVariants;
              updatedProduct.variants = newVariants;
              updatedProduct.stockLevel = newVariants.reduce((sum: number, v: any) => sum + (v.stockLevel || 0), 0);
              isUpdated = true;
            }
          }

          // 2. Update Pricing Fields
          if (variantId && product.hasVariants && updatedVariants.length > 0) {
            const vIdx = updatedVariants.findIndex(v => v.id === variantId);
            if (vIdx !== -1) {
              const origV = updatedVariants[vIdx];
              const newPriceForeign = priceForeign !== undefined ? Number(priceForeign) : origV.priceForeign;
              const newCurrencyForeign = currencyForeign !== undefined ? String(currencyForeign) : origV.currencyForeign;
              const newPriceRIYAL = priceRIYAL !== undefined ? Number(priceRIYAL) : origV.priceRIYAL;

              if (
                newPriceForeign !== origV.priceForeign ||
                newCurrencyForeign !== origV.currencyForeign ||
                newPriceRIYAL !== origV.priceRIYAL
              ) {
                updatedVariants[vIdx] = {
                  ...origV,
                  priceForeign: newPriceForeign,
                  currencyForeign: newCurrencyForeign,
                  priceRIYAL: newPriceRIYAL
                };
                isUpdated = true;
              }
            }
          } else {
            // Non-variant or updating main product pricing
            if (priceRIYAL !== undefined && Number(priceRIYAL) !== product.basePriceRIYAL) {
              updatedProduct.basePriceRIYAL = Number(priceRIYAL);
              isUpdated = true;
            }
          }

          // 3. Handle stock adjustments
          const hasStockChange =
            supplyType === "INVENTORY" &&
            !isNaN(amt) &&
            amt > 0 &&
            (type === "IN" || type === "OUT");

          if (hasStockChange) {
            if (product.hasVariants && !variantId) {
              // skip stock update for parent product
            } else {
              const adjustedAmt = type === "IN" ? amt : -amt;
              if (variantId && product.hasVariants && updatedVariants.length > 0) {
                const vIdx = updatedVariants.findIndex(v => v.id === variantId);
                if (vIdx !== -1) {
                  const beforeVStock = updatedVariants[vIdx].stockLevel || 0;
                  const afterVStock = Math.max(0, beforeVStock + adjustedAmt);
                  updatedVariants[vIdx] = { ...updatedVariants[vIdx], stockLevel: afterVStock };
                  const newTotalStock = updatedVariants.reduce((sum, v) => sum + (v.stockLevel || 0), 0);
                  updatedProduct.variants = updatedVariants;
                  updatedProduct.stockLevel = newTotalStock;
                  isUpdated = true;
                }
              } else {
                beforeStock = product.stockLevel || 0;
                afterStock = Math.max(0, beforeStock + adjustedAmt);
                updatedProduct.stockLevel = afterStock;
                isUpdated = true;
              }

              newTransactions.push({
                id: `inv-tr-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
                productId: product.id,
                variantId: variantId,
                date: dateVal || nowStr,
                type: adjustedAmt > 0 ? "IN" : "OUT",
                quantity: amt,
                referenceType: "MANUAL",
                notes,
              });
            }
          }

          if (isUpdated || hasStockChange) {
            if (updatedVariants.length > 0) {
              updatedProduct.variants = updatedVariants;
            }
            currentProducts[prodIndex] = updatedProduct;
            successCount++;

            logAction(
              "UPDATE",
              "کالاها",
              product.id,
              `بروزرسانی کالا (واردات گروهی): ${product.name} (کد: ${variantId ? code : product.code})`,
              product,
              updatedProduct,
            );
          }
        } else if (name && category) {
          // CREATE NEW PRODUCT (either code is empty, or code was supplied but prodIndex === -1)
          const seqNum = (settings.documentFormats.productStartSeq || 1) + currentProducts.length;
          const finalCode = code || formatERPNumber(
            settings.documentFormats.productFormat || "EQ-{RAND:5}",
            {
              seq: seqNum,
              category: category,
            },
          );
          const initialStock =
            supplyType === "INVENTORY" && !isNaN(amt) && amt > 0 ? amt : 0;
            
          let hasVariants = features.length > 0;
          let variants: any[] = [];
          if (hasVariants) {
            const getCombinations = (featuresArr: any[]): any[] => {
              if (featuresArr.length === 0) return [{}];
              const current = featuresArr[0];
              const rest = getCombinations(featuresArr.slice(1));
              const combos: any[] = [];
              if (current.options.length === 0) return rest;
              for (const opt of current.options) {
                for (const r of rest) {
                  combos.push({ ...r, [current.name]: opt.value });
                }
              }
              return combos;
            };
            const combinations = getCombinations(features);
            const pCode = finalCode;
            variants = combinations.map((combo, i) => {
              const skuParts = [pCode];
              features.forEach((feat) => {
                const fVal = combo[feat.name];
                if (fVal) {
                  const optIndex = feat.options.findIndex(o => o.value === fVal);
                  if (optIndex !== -1) {
                    const prefix = feat.code ? feat.code : '';
                    skuParts.push(`${prefix}${optIndex + 1}`);
                  }
                }
              });
              return {
                id: `var-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 5)}`,
                sku: skuParts.join('-'),
                attributes: combo,
                stockLevel: 0,
                minStockLevel: 0,
                priceForeign: priceForeign !== undefined ? Number(priceForeign) : undefined,
                currencyForeign: currencyForeign || undefined,
                priceRIYAL: priceRIYAL !== undefined ? Number(priceRIYAL) : undefined
              };
            });
          }
          
          const newProduct: any = {
            id: `prod-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
            code: finalCode,
            name: name,
            displayName: name,
            category: category,
            supplyType: supplyType,
            description: notes,
            images: [],
            brand: brand,
            modelNumber: "N/A",
            unit: "عدد",
            basePriceRIYAL: priceRIYAL !== undefined ? Number(priceRIYAL) : 0,
            minStockLevel: 0,
            stockLevel: hasVariants ? 0 : initialStock,
            customValues: {},
            features: features,
            hasVariants: hasVariants,
            variants: variants
          };
          currentProducts = [newProduct, ...currentProducts];
          createCount++;

          if (initialStock > 0) {
            newTransactions.push({
              id: `inv-tr-${Date.now()}-${index}-init`,
              productId: newProduct.id,
              date: dateVal || nowStr,
              type: "IN",
              quantity: initialStock,
              referenceType: "MANUAL",
              notes: "موجودی اولیه (واردات گروهی)",
            });
          }

          logAction(
            "CREATE",
            "کالاها",
            newProduct.id,
            `ایجاد کالای جدید (واردات گروهی): ${newProduct.name} (کد: ${newProduct.code})`,
            undefined,
            newProduct,
          );
        }
      });

      saveToServer("erp_products", currentProducts);
      return currentProducts;
    });

    if (newTransactions.length > 0) {
      setInventoryTransactions((prev) => {
        const updatedTr = [...newTransactions, ...prev];
        saveToServer("erp_inventory_transactions", updatedTr);
        return updatedTr;
      });
    }

    return { successCount, createCount };
  };

  const adjustMultipleProductsStock = (
    adjustments: Array<{
      productId: string;
      amount: number;
      variantId?: string;
      referenceId?: string;
      referenceType?: InventoryTransaction["referenceType"];
      notes?: string;
      transactionDate?: string;
    }>
  ) => {
    const validAdjustments = adjustments.filter(adj => adj.amount !== 0);
    if (validAdjustments.length === 0) return;

    // Create all transactions
    const newTransactions: InventoryTransaction[] = validAdjustments.map(adj => ({
      id: `inv-tr-${Date.now()}-${Math.random().toString(36).substr(2, 5)}-${Math.floor(Math.random() * 1000)}`,
      productId: adj.productId,
      variantId: adj.variantId,
      date: adj.transactionDate || new Date().toISOString(),
      type: adj.amount > 0 ? "IN" : "OUT",
      quantity: Math.abs(adj.amount),
      referenceId: adj.referenceId,
      referenceType: adj.referenceType,
      notes: adj.notes,
    }));

    setInventoryTransactions((prev) => {
      const updatedTr = [...newTransactions, ...prev];
      saveToServer("erp_inventory_transactions", updatedTr);
      return updatedTr;
    });

    setProducts((prevProducts) => {
      const updated = prevProducts.map((p) => {
        // Find all adjustments for this product
        const productAdjs = validAdjustments.filter(adj => adj.productId === p.id);
        if (productAdjs.length === 0) return p;

        let updatedProduct = { ...p };
        productAdjs.forEach(adj => {
          if (adj.variantId && updatedProduct.hasVariants && updatedProduct.variants) {
            const vIdx = updatedProduct.variants.findIndex((v) => v.id === adj.variantId);
            if (vIdx !== -1) {
              const newVariants = [...updatedProduct.variants];
              newVariants[vIdx] = {
                ...newVariants[vIdx],
                stockLevel: (newVariants[vIdx].stockLevel || 0) + adj.amount,
              };
              const newTotalStock = newVariants.reduce((sum, v) => sum + (v.stockLevel || 0), 0);
              updatedProduct = { ...updatedProduct, variants: newVariants, stockLevel: newTotalStock };
            }
          } else {
            updatedProduct = { ...updatedProduct, stockLevel: (updatedProduct.stockLevel || 0) + adj.amount };
          }
        });
        return updatedProduct;
      });

      saveToServer("erp_products", updated);

      // Log actions for changed products
      validAdjustments.forEach(adj => {
        const before = prevProducts.find((p) => p.id === adj.productId);
        const after = updated.find((p) => p.id === adj.productId);
        if (before && after) {
          logAction(
            "UPDATE",
            "کالاها",
            adj.productId,
            `اصلاح موجودی کالا (بچ): ${after.name} (تغییر: ${adj.amount > 0 ? "+" : ""}${adj.amount} - موجودی جدید: ${after.stockLevel})`,
            before,
            after
          );
          if (after.stockLevel < (after.minStockLevel || 0)) {
            processWorkflowRules('product_low_stock', after);
          }
        }
      });

      return updated;
    });
  };

  const adjustProductStock = (
    id: string,
    amount: number,
    variantId?: string,
    referenceId?: string,
    referenceType?: InventoryTransaction["referenceType"],
    notes?: string,
    transactionDate?: string,
  ) => {
    adjustMultipleProductsStock([{
      productId: id,
      amount,
      variantId,
      referenceId,
      referenceType,
      notes,
      transactionDate
    }]);
  };

  // --- Suppliers CRUD ---
  const addSupplier = (supplier: Omit<Supplier, "id">) => {
    const newSupplier: Supplier = { createdAt: new Date().toISOString(),
      ...supplier,
      id: `supp-${Date.now()}`,
      
    };
    const updated = [newSupplier, ...suppliers];
    saveToStorage("erp_suppliers", updated, setSuppliers);
    logAction(
      "CREATE",
      "تامین‌کنندگان",
      newSupplier.id,
      `ثبت تامین‌کننده جدید: ${newSupplier.name}`,
      undefined,
      newSupplier,
    );
    processWorkflowRules('supplier_created', newSupplier);
    return newSupplier;
  };

  const updateSupplier = (updatedSupp: Supplier) => {
    const before = suppliers.find((s) => s.id === updatedSupp.id);
    const updated = suppliers.map((s) =>
      s.id === updatedSupp.id ? updatedSupp : s,
    );
    saveToStorage("erp_suppliers", updated, setSuppliers);
    logAction(
      "UPDATE",
      "تامین‌کنندگان",
      updatedSupp.id,
      `ویرایش اطلاعات تامین‌کننده: ${updatedSupp.name}`,
      before,
      updatedSupp,
    );
  };

  const deleteSupplier = (id: string) => {
    const before = suppliers.find((s) => s.id === id);
    const updated = suppliers.filter((s) => s.id !== id);
    saveToStorage("erp_suppliers", updated, setSuppliers);
    logAction(
      "DELETE",
      "تامین‌کنندگان",
      id,
      `حذف تامین‌کننده: ${before?.name}`,
      before,
      undefined,
    );
  };

  const batchImportSuppliers = (items: any[]) => {
    let successCount = 0;
    setSuppliers((prev) => {
      let currentSuppliers = [...prev];
      items.forEach((item) => {
        if (item.name) {
          const newSupp: Supplier = {
            id: `supp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            createdAt: new Date().toISOString(),
            name: item.name,
            country: item.country || "",
            contactName: item.contactName || "",
            phone: item.phone,
            email: item.email,
            website: item.website,
            paymentTerms: item.paymentTerms,
            status: item.status === "غیرفعال" ? "غیرفعال" : "فعال",
            
            description: item.description,
          };
          currentSuppliers = [newSupp, ...currentSuppliers];
          successCount++;
        }
      });
      saveToStorage("erp_suppliers", currentSuppliers, setSuppliers);
      return currentSuppliers;
    });
    return { successCount, createCount: successCount };
  };

  // --- Transactions ---
  const addTransaction = (t: Omit<Transaction, "id">) => {
    const newTr: Transaction = {
      ...t,
      id: `tr-${Date.now()}`,
      
    };
    const updated = [newTr, ...transactions];
    saveToStorage("erp_transactions", updated, setTransactions);
    
    autoLogFactActivity(newTr.projectId, 'تراکنش‌های مالی و پرداخت‌ها', `ثبت تراکنش ${newTr.type === 'دریافت' ? 'دریافت وجه از مشتری' : 'پرداخت وجه به تامین‌کننده'} بابت پروژه به مبلغ ${newTr.amountRIYAL?.toLocaleString() || 0} ریال (روش: ${newTr.paymentType || '-'}، تاریخ: ${newTr.date || '-'})`);
    notifyModuleResponsible('transactions', 'ثبت تراکنش مالی جدید', `تراکنش ${newTr.type} به مبلغ ${newTr.amountRIYAL?.toLocaleString() || 0} ریال ثبت شد.`, newTr.projectId);
    processWorkflowRules('transaction_created', newTr);
    return newTr;
  };

  const updateTransaction = (t: Transaction) => {
    const updated = transactions.map((tr) => (tr.id === t.id ? t : tr));
    saveToStorage("erp_transactions", updated, setTransactions);
    
    autoLogFactActivity(t.projectId, 'تراکنش‌های مالی و پرداخت‌ها', `ویرایش تراکنش ${t.type === 'دریافت' ? 'دریافت وجه' : 'پرداخت وجه'} بابت پروژه (مبلغ جدید: ${t.amountRIYAL?.toLocaleString() || 0} ریال، تاریخ: ${t.date || '-'})`);
  };

  const deleteTransaction = (id: string) => {
    const tr = transactions.find((t) => t.id === id);
    const updated = transactions.filter((t) => t.id !== id);
    saveToStorage("erp_transactions", updated, setTransactions);
    if (tr?.projectId) {
      autoLogFactActivity(tr.projectId, 'تراکنش‌های مالی و پرداخت‌ها', `حذف تراکنش ${tr.type === 'دریافت' ? 'دریافت وجه' : 'پرداخت وجه'} مربوط به پروژه (مبلغ: ${tr.amountRIYAL?.toLocaleString() || 0} ریال)`);
    }
  };

  // --- Purchase Orders ---
  const addPurchaseOrder = (po: Omit<PurchaseOrder, "id">) => {
    let finalCode = po.poNumber;
    const isAutoGenerated = !finalCode || finalCode.startsWith("PO-");
    if (isAutoGenerated) {
      finalCode = formatERPNumber(
        settings.documentFormats.poFormat || "PO-{YYYY}-{SEQ:4}",
        { seq: (settings.documentFormats.poStartSeq || 1) + purchaseOrders.length },
      );
    }
    const newPO: PurchaseOrder = {
      ...po,
      poNumber: finalCode,
      id: `po-${Date.now()}`,
      
    };
    const updated = [newPO, ...purchaseOrders];
    saveToStorage("erp_purchase_orders", updated, setPurchaseOrders);
    logAction(
      "CREATE",
      "سفارش خرید",
      newPO.id,
      `ایجاد سفارش خرید جدید: ${newPO.poNumber}`,
      undefined,
      newPO,
    );
    
    const supplierObj = suppliers.find(s => s.id === newPO.supplierId);
    const suppName = supplierObj ? (supplierObj.companyName || supplierObj.name) : (newPO.supplierName || newPO.supplierId || '');
    autoLogFactActivity(newPO.projectId, 'سفارشات خرید تامین‌کنندگان', `صدور سفارش خرید (شماره: ${newPO.poNumber}) برای تأمین‌کننده «${suppName}» جهت تأمین اقلام پروژه.`);
    notifyModuleResponsible('purchaseOrders', 'ثبت سفارش خرید جدید', `سفارش خرید شماره ${newPO.poNumber} ثبت شد.`, newPO.projectId);
    processWorkflowRules('purchase_order_created', newPO);
    return newPO;
  };

  const updatePurchaseOrder = (updatedPO: PurchaseOrder) => {
    const before = purchaseOrders.find((p) => p.id === updatedPO.id);
    const updated = purchaseOrders.map((p) =>
      p.id === updatedPO.id ? updatedPO : p,
    );
    saveToStorage("erp_purchase_orders", updated, setPurchaseOrders);
    logAction(
      "UPDATE",
      "سفارش خرید",
      updatedPO.id,
      `ویرایش سفارش خرید: ${updatedPO.poNumber}`,
      before,
      updatedPO,
    );
    
    const supplierObj = suppliers.find(s => s.id === updatedPO.supplierId);
    const suppName = supplierObj ? (supplierObj.companyName || supplierObj.name) : (updatedPO.supplierName || updatedPO.supplierId || '');
    autoLogFactActivity(updatedPO.projectId, 'سفارشات خرید تامین‌کنندگان', `تغییر وضعیت سفارش خرید (شماره: ${updatedPO.poNumber}) مرتبط با تأمین‌کننده «${suppName}» به «${updatedPO.status}».`);
    notifyModuleResponsible('purchaseOrders', 'ویرایش سفارش خرید', `سفارش خرید شماره ${updatedPO.poNumber} ویرایش شد.`, updatedPO.projectId);

    processWorkflowRules('purchase_order_status_change', { newStatus: updatedPO.status, oldStatus: before?.status, ...updatedPO });

    // Self-healing inventory stock adjustments
    if (before) {
      if (before.status === 'تحویل شده (رسید انبار)') {
        // Revert old items (subtract)
        before.items?.forEach(item => {
          adjustProductStock(
            item.productId,
            -(item.quantity || 1),
            item.variantId,
            before.id,
            'PURCHASE_ORDER' as const,
            `اصلاح موجودی به دلیل ویرایش سفارش خرید تحویل شده ${updatedPO.poNumber}`
          );
        });
      }
      if (updatedPO.status === 'تحویل شده (رسید انبار)') {
        // Apply new items (add)
        updatedPO.items?.forEach(item => {
          adjustProductStock(
            item.productId,
            (item.quantity || 1),
            item.variantId,
            updatedPO.id,
            'PURCHASE_ORDER' as const,
            `افزایش موجودی به دلیل تحویل سفارش خرید ${updatedPO.poNumber}`
          );
        });
      }
    }

    if (before?.status !== updatedPO.status && updatedPO.status === 'تحویل شده (رسید انبار)') {
      setCompletionPrompt({
        projectId: updatedPO.projectId,
        categoryName: 'سفارشات خرید تامین‌کنندگان',
        message: `سفارش خرید ${updatedPO.poNumber} به انبار تحویل شد. آیا می‌خواهید وضعیت فعالیت‌های سفارش خرید این پروژه را به «اتمام کار» تغییر دهید؟`
      });
    }
  };

  const deletePurchaseOrder = (id: string) => {
    const before = purchaseOrders.find((p) => p.id === id);
    if (!before) return;

    if (before.status === 'تحویل شده (رسید انبار)') {
      // Revert the receipt of warehouse by decreasing stock
      before.items?.forEach(item => {
        adjustProductStock(
          item.productId,
          -(item.quantity || 1),
          item.variantId,
          before.id,
          'PURCHASE_ORDER' as const,
          `کاهش موجودی به دلیل حذف سفارش خرید تحویل شده ${before.poNumber}`
        );
      });
    }

    const updated = purchaseOrders.filter((p) => p.id !== id);
    saveToStorage("erp_purchase_orders", updated, setPurchaseOrders);
    logAction(
      "DELETE",
      "سفارش خرید",
      id,
      `حذف سفارش خرید: ${before?.poNumber}`,
      before,
      undefined,
    );

    if (before.projectId) {
      autoLogFactActivity(
        before.projectId,
        'سفارشات خرید تامین‌کنندگان',
        `سفارش خرید شماره ${before.poNumber} از سیستم حذف شد.`
      );
    }
  };




  const addProject = (project: Omit<Project, 'id' | 'code' | 'creationDate'>) => {
  const seqNum = (settings.documentFormats.projectStartSeq || 1) + projects.length;
  const computedCode = formatERPNumber(
    settings.documentFormats?.projectFormat || 'ATA-{YYYY}-{SEQ:3}',
    {
      seq: seqNum,
      customerName: (project as any).customerName || (project as any).title || ''
    }
  );
  const newProject: Project = {
    ...project,
    id: `proj-${Date.now()}`,
    code: computedCode,
    creationDate: getTodayShamsi()
  } as Project;
  const updated = [newProject, ...projects];
  saveToStorage('erp_projects', updated, setProjects);

  notifyModuleResponsible('projects', 'ثبت پروژه جدید', `پروژه جدید ${newProject.name} (${newProject.code}) توسط ${currentUser?.fullName || 'کاربر سیستم'} ایجاد شد.`, newProject.id);
  logAction('CREATE', 'پروژه‌ها', newProject.id, `ثبت پروژه جدید: ${newProject.name} (کد: ${newProject.code})`, undefined, newProject);
  processWorkflowRules('project_created', newProject);

  return newProject;
};
  const updateProject = (updatedProject: any) => {
    const oldProject = projects.find(p => p.id === updatedProject.id);
    if (oldProject && oldProject.status !== updatedProject.status) {
      processWorkflowRules('project_status_change', { newStatus: updatedProject.status, ...updatedProject });
    }
    
    // Check for newly completed project milestones and run automated milestone rules
    if (oldProject && updatedProject.milestones) {
      const oldCompletedIds = new Set(
        (oldProject.milestones || [])
          .filter((m: any) => m.isCompleted)
          .map((m: any) => m.id)
      );
      
      updatedProject.milestones.forEach((m: any) => {
        if (m.isCompleted && !oldCompletedIds.has(m.id)) {
          // This milestone was just completed! Run the associated milestone rules
          const rules = updatedProject.milestoneRules?.filter((r: any) => r.triggerMilestoneId === m.id) || [];
          rules.forEach((rule: any) => {
            if (rule.actionType === 'create_task') {
              addTask({
                title: rule.taskTitle || `پیگیری نقطه حیاتی: ${m.name}`,
                description: rule.taskDesc || `این کار به صورت خودکار با اتمام نقطه حیاتی "${m.name}" ایجاد شد.`,
                relatedToType: 'پروژه',
                relatedToId: updatedProject.id,
                relatedToName: updatedProject.name,
                priority: rule.priority || 'متوسط',
                dueDate: addDaysToShamsi(getTodayShamsi(), rule.dueDaysOffset || 0),
                assignedTo: rule.assignedTo || 'admin',
                status: 'در حال انجام',
              });
            } else if (rule.actionType === 'send_notification') {
              addModuleNotification({
                module: 'projects',
                title: rule.taskTitle || `رویداد پروژه: اتمام ${m.name}`,
                description: rule.taskDesc || `نقطه حیاتی "${m.name}" در پروژه "${updatedProject.name}" انجام شد.`,
                responsibleName: rule.assignedTo || 'admin',
              });
            }
          });
        }
      });
    }

    const updated = projects.map(p => p.id === updatedProject.id ? updatedProject : p);
    saveToStorage("erp_projects", updated, setProjects);
    logAction("UPDATE", "پروژه", updatedProject.id, `بروزرسانی پروژه: ${updatedProject.title}`);
  };
  const deleteProject = (id: string) => {
    const updated = projects.filter(p => p.id !== id);
    saveToStorage("erp_projects", updated, setProjects);
    logAction("DELETE", "پروژه", id, `حذف پروژه`);
  };

  const addProforma = (proforma: Omit<Proforma, 'id' | 'proformaNumber'>) => {
  const seqNum = (settings.documentFormats.proformaStartSeq || 1) + proformas.length;
  const projectCode = proforma.projectId
    ? (projects.find(p => p.id === proforma.projectId)?.code || 'ATA')
    : 'ATA';

  let formatStr = settings.documentFormats?.proformaFormat || "QT-{PROJECT}-{SEQ:2}";
  if (proforma.proformaType === "TECHNICAL") {
    formatStr = settings.documentFormats?.proformaTechnicalFormat || formatStr;
  } else if (proforma.proformaType === "AFTER_SALES") {
    formatStr = settings.documentFormats?.proformaAfterSalesFormat || formatStr;
  }

  const computedNumber = formatERPNumber(
    formatStr,
    {
      seq: seqNum,
      projectCode,
      customerName: proforma.customerName || ''
    }
  );

  const newProforma: Proforma = {
    ...proforma,
    id: `pf-${Date.now()}`,
    proformaNumber: computedNumber,
    creatorId: currentUser?.id
  } as Proforma;

  const updated = [newProforma, ...proformas];
  saveToStorage('erp_proformas', updated, setProformas);

  if (newProforma.projectId) {
    const syncedProjects = syncProjectStatus(newProforma.projectId, updated, projects);
    saveToStorage('erp_projects', syncedProjects, setProjects);

    const statusLabel = newProforma.status;
    autoLogFactActivity(
      newProforma.projectId,
      'پیش‌فاکتورها و مهندسی فروش',
      `صدور پیش‌فاکتور جدید (شماره: ${newProforma.proformaNumber}) با مبلغ کل ${(newProforma.totalAmount || 0).toLocaleString('fa-IR')} ${newProforma.currency || 'ریال'} (کاربر ثبت‌کننده: ${currentUser?.fullName || 'سیستم'}، وضعیت: ${statusLabel}).`
    );
  }

  // If instantly created as "won" or contains won items, reduce inventory stock in batch
  const initialWonItems = getWonItemsOfProforma(newProforma);
  if (initialWonItems.length > 0) {
    const adjustments = initialWonItems.map(item => ({
      productId: item.productId,
      variantId: item.variantId,
      amount: -(item.quantity || 1),
      referenceId: newProforma.id,
      referenceType: 'PROFORMA' as const,
      notes: `خروج به دلیل پیش‌فاکتور ${newProforma.proformaNumber}`
    }));
    adjustMultipleProductsStock(adjustments);
  }

  notifyModuleResponsible('proformas', 'ثبت پیش‌فاکتور جدید', `پیش‌فاکتور شماره ${newProforma.proformaNumber} صادر شد.`, newProforma.projectId);
  logAction('CREATE', 'پیش‌فاکتورها', newProforma.id, `ایجاد پیش‌فاکتور جدید شماره ${newProforma.proformaNumber} به مبلغ کل ${(newProforma.totalAmount || 0).toLocaleString('fa-IR')} ${newProforma.currency || 'ریال'}`, undefined, newProforma);

  processWorkflowRules('proforma_created', newProforma);

  const newOutcome = getProformaOutcomeStatus(newProforma);
  const relatedProj = newProforma.projectId ? projects.find(p => p.id === newProforma.projectId) : undefined;
  processWorkflowRules('proforma_outcome_change', {
    projectId: newProforma.projectId,
    projectName: relatedProj?.name || relatedProj?.title || newProforma.customerName,
    proformaNumber: newProforma.proformaNumber,
    oldOutcome: '',
    newOutcome,
    salesExpert: relatedProj?.salesExpert
  });

  return newProforma;
};
  const updateProforma = (updatedPf: Proforma) => {
  const oldPf = proformas.find(p => p.id === updatedPf.id);
  if (!oldPf) return;

  const finalUpdatedPf = { ...updatedPf };
  const newOutcome = getProformaOutcomeStatus(finalUpdatedPf);
  finalUpdatedPf.status = newOutcome;

  const updated = proformas.map(p => p.id === updatedPf.id ? finalUpdatedPf : p);
  saveToStorage('erp_proformas', updated, setProformas);

  const oldOutcome = getProformaOutcomeStatus(oldPf);
  const outcomeChanged = oldOutcome !== newOutcome;

  let logText = `ویرایش پیش‌فاکتور (شماره: ${finalUpdatedPf.proformaNumber}).`;
  if (outcomeChanged) {
    logText += ` وضعیت نهایی اقلام پیش‌فاکتور به «${newOutcome}» تغییر یافت.`;
  }

  logAction('UPDATE', 'پیش‌فاکتورها', updatedPf.id, logText, oldPf, finalUpdatedPf);

  if (finalUpdatedPf.projectId) {
    const syncedProjects = syncProjectStatus(finalUpdatedPf.projectId, updated, projects);
    saveToStorage('erp_projects', syncedProjects, setProjects);

    autoLogFactActivity(finalUpdatedPf.projectId, 'پیش‌فاکتورها و مهندسی فروش', logText);

    if (outcomeChanged && (newOutcome === 'تأیید شده (برنده)' || newOutcome === 'نیمه برنده')) {
      setCompletionPrompt({
        projectId: finalUpdatedPf.projectId,
        categoryName: 'پیش‌فاکتورها و مهندسی فروش',
        message: `پیش‌فاکتور ${finalUpdatedPf.proformaNumber} تایید شد (${newOutcome === 'تأیید شده (برنده)' ? 'برنده' : 'نیمه برنده'}). آیا می‌خواهید وضعیت فعالیت‌های پیش‌فاکتور این پروژه را به «اتمام کار» تغییر دهید؟`
      });
    }
  }

  if (outcomeChanged) {
    const relatedProj = finalUpdatedPf.projectId ? projects.find(p => p.id === finalUpdatedPf.projectId) : undefined;
    processWorkflowRules('proforma_outcome_change', {
      projectId: finalUpdatedPf.projectId,
      projectName: relatedProj?.name || relatedProj?.title || finalUpdatedPf.customerName,
      proformaNumber: finalUpdatedPf.proformaNumber,
      oldOutcome,
      newOutcome,
      salesExpert: relatedProj?.salesExpert
    });
  }

  // Dynamic self-healing inventory adjustment in batch
  const adjustments: Array<{
    productId: string;
    variantId?: string;
    amount: number;
    referenceId: string;
    referenceType: 'PROFORMA';
    notes: string;
  }> = [];

  const oldWon = getWonItemsOfProforma(oldPf);
  oldWon.forEach(item => {
    adjustments.push({
      productId: item.productId,
      variantId: item.variantId,
      amount: (item.quantity || 1),
      referenceId: oldPf.id,
      referenceType: 'PROFORMA',
      notes: `بازگشت موجودی پیش‌فاکتور ${oldPf.proformaNumber}`
    });
  });

  const newWon = getWonItemsOfProforma(finalUpdatedPf);
  newWon.forEach(item => {
    adjustments.push({
      productId: item.productId,
      variantId: item.variantId,
      amount: -(item.quantity || 1),
      referenceId: finalUpdatedPf.id,
      referenceType: 'PROFORMA',
      notes: `خروج به دلیل پیش‌فاکتور ${finalUpdatedPf.proformaNumber}`
    });
  });

  if (adjustments.length > 0) {
    adjustMultipleProductsStock(adjustments);
  }

  notifyModuleResponsible('proformas', 'ویرایش پیش‌فاکتور', `پیش‌فاکتور شماره ${finalUpdatedPf.proformaNumber} ویرایش شد.`, finalUpdatedPf.projectId);
};
  const deleteProforma = (id: string) => {
    const record = proformas.find(p => p.id === id);
    if (!record) return;

    // 1. Revert won items stock (add back with positive amount)
    const wonItems = getWonItemsOfProforma(record);
    wonItems.forEach(item => {
      adjustProductStock(
        item.productId,
        (item.quantity || 1),
        item.variantId,
        record.id,
        'PROFORMA' as const,
        `بازگشت موجودی به دلیل حذف پیش‌فاکتور ${record.proformaNumber}`
      );
    });

    const updated = proformas.filter(p => p.id !== id);
    saveToStorage("erp_proformas", updated, setProformas);
    logAction("DELETE", "پیش‌فاکتور", id, `حذف پیش‌فاکتور شماره ${record.proformaNumber}`);

    if (record.projectId) {
      const syncedProjects = syncProjectStatus(record.projectId, updated, projects);
      saveToStorage('erp_projects', syncedProjects, setProjects);

      autoLogFactActivity(
        record.projectId,
        'پیش‌فاکتورها و مهندسی فروش',
        `پیش‌فاکتور شماره ${record.proformaNumber} از سیستم حذف شد.`
      );
    }
  };
  const updateProformaStatus = (id: string, newStatus: Proforma['status'], lossReason?: string, sentMethod?: string, sentRecipients?: string[]) => {
  const oldProforma = proformas.find(p => p.id === id);
  if (!oldProforma) return;

  const updated = proformas.map(p => {
    if (p.id === id) {
      let updatedItems = p.items || [];
      if (newStatus === 'تأیید شده (برنده)') {
        updatedItems = updatedItems.map(item => ({ ...item, status: 'برنده' as const }));
      } else if (newStatus === 'باخته') {
        updatedItems = updatedItems.map(item => ({ ...item, status: 'بازنده' as const, lossReason: lossReason || item.lossReason }));
      } else if (newStatus === 'پیش‌نویس' || newStatus === 'ارسال شده') {
        updatedItems = updatedItems.map(item => ({ ...item, status: 'جاری' as const }));
      }

      return {
        ...p,
        status: newStatus,
        isCancelled: false,
        lossReason: newStatus === 'باخته' ? lossReason : p.lossReason,
        items: updatedItems,
        sentMethod: newStatus === 'ارسال شده' ? sentMethod : p.sentMethod,
        sentRecipients: newStatus === 'ارسال شده' ? sentRecipients : p.sentRecipients
      };
    }
    return p;
  });

  saveToStorage('erp_proformas', updated as Proforma[], setProformas);

  const newProformaObj = updated.find(p => p.id === id);
  logAction('UPDATE', 'پیش‌فاکتورها', id, `تغییر وضعیت ارسال پیش‌فاکتور شماره ${oldProforma.proformaNumber} به «${newStatus}»`, oldProforma, newProformaObj);

  if (oldProforma.projectId) {
    const syncedProjects = syncProjectStatus(oldProforma.projectId, updated as Proforma[], projects);
    saveToStorage('erp_projects', syncedProjects, setProjects);

    const reasonStr = newStatus === 'باخته' && lossReason ? ` (علت باخت: ${lossReason})` : '';
    autoLogFactActivity(
      oldProforma.projectId,
      'پیش‌فاکتورها و مهندسی فروش',
      `تغییر وضعیت پیش‌فاکتور (شماره: ${oldProforma.proformaNumber}) به «${newStatus}» توسط کاربر ${currentUser?.fullName || 'سیستم'}.${reasonStr}`
    );
  }

  // Dynamic self-healing inventory adjustment in batch
  if (newProformaObj) {
    const adjustments: Array<{
      productId: string;
      variantId?: string;
      amount: number;
      referenceId: string;
      referenceType: 'PROFORMA';
      notes: string;
    }> = [];

    // 1. Revert old won items (add back)
    const oldWon = getWonItemsOfProforma(oldProforma);
    oldWon.forEach(item => {
      adjustments.push({
        productId: item.productId,
        variantId: item.variantId,
        amount: (item.quantity || 1),
        referenceId: oldProforma.id,
        referenceType: 'PROFORMA',
        notes: `بازگشت موجودی پیش‌فاکتور ${oldProforma.proformaNumber}`
      });
    });

    // 2. Deduct new won items (subtract)
    const newWon = getWonItemsOfProforma(newProformaObj as Proforma);
    newWon.forEach(item => {
      adjustments.push({
        productId: item.productId,
        variantId: item.variantId,
        amount: -(item.quantity || 1),
        referenceId: newProformaObj.id,
        referenceType: 'PROFORMA',
        notes: `خروج به دلیل پیش‌فاکتور ${newProformaObj.proformaNumber}`
      });
    });

    if (adjustments.length > 0) {
      adjustMultipleProductsStock(adjustments);
    }

    // 3. Trigger workflows + completion prompt
    const oldOutcome = getProformaOutcomeStatus(oldProforma);
    const newOutcome = getProformaOutcomeStatus(newProformaObj as Proforma);
    if (oldOutcome !== newOutcome) {
      const relatedProj = oldProforma.projectId ? projects.find(p => p.id === oldProforma.projectId) : undefined;
      processWorkflowRules('proforma_outcome_change', {
        projectId: oldProforma.projectId,
        projectName: relatedProj?.name || relatedProj?.title || oldProforma.customerName,
        proformaNumber: oldProforma.proformaNumber,
        oldOutcome,
        newOutcome,
        salesExpert: relatedProj?.salesExpert
      });

      if (oldProforma.projectId && (newOutcome === 'تأیید شده (برنده)' || newOutcome === 'نیمه برنده')) {
        setCompletionPrompt({
          projectId: oldProforma.projectId,
          categoryName: 'پیش‌فاکتورها و مهندسی فروش',
          message: `پیش‌فاکتور ${oldProforma.proformaNumber} تایید شد (${newOutcome === 'تأیید شده (برنده)' ? 'برنده' : 'نیمه برنده'}). آیا می‌خواهید وضعیت فعالیت‌های پیش‌فاکتور این پروژه را به «اتمام کار» تغییر دهید؟`
        });
      }
    }
  }
};
  const batchUpdateProjectProformasStatus = (projectId: string, status: any, lossReason?: string) => {
    // Collect any previously won items to release them back to inventory (if status is cancel/lost)
    const projectProformas = proformas.filter(p => p.projectId === projectId);
    const adjustments: Array<{
      productId: string;
      variantId?: string;
      amount: number;
      referenceId: string;
      referenceType: 'PROFORMA';
      notes: string;
    }> = [];

    if (status === 'لغو شده' || status === 'باخته') {
      projectProformas.forEach(oldPf => {
        const oldOutcome = getProformaOutcomeStatus(oldPf);
        if (oldOutcome === 'تأیید شده (برنده)' || oldOutcome === 'نیمه برنده') {
          const oldWon = getWonItemsOfProforma(oldPf);
          oldWon.forEach(item => {
            adjustments.push({
              productId: item.productId,
              variantId: item.variantId,
              amount: (item.quantity || 1),
              referenceId: oldPf.id,
              referenceType: 'PROFORMA',
              notes: `بازگشت موجودی به علت لغو/باخت تمام پیش‌فاکتورهای پروژه (${oldPf.proformaNumber})`
            });
          });
        }
      });
    }

    const updated = proformas.map(p => {
      if (p.projectId === projectId) {
        let updatedItems = p.items || [];
        if (status === 'تأیید شده (برنده)') {
          updatedItems = updatedItems.map(item => ({ ...item, status: 'برنده' as const }));
        } else if (status === 'باخته') {
          updatedItems = updatedItems.map(item => ({ ...item, status: 'بازنده' as const, lossReason: lossReason || item.lossReason }));
        } else if (status === 'لغو شده') {
          updatedItems = updatedItems.map(item => ({ ...item, status: 'لغو شده' as const }));
        } else if (status === 'پیش‌نویس' || status === 'ارسال شده') {
          updatedItems = updatedItems.map(item => ({ ...item, status: 'جاری' as const }));
        }

        return {
          ...p,
          status,
          isCancelled: status === 'لغو شده' ? true : p.isCancelled,
          lossReason: status === 'باخته' ? lossReason : p.lossReason,
          items: updatedItems
        };
      }
      return p;
    });

    saveToStorage("erp_proformas", updated, setProformas);

    if (adjustments.length > 0) {
      adjustMultipleProductsStock(adjustments);
    }

    if (projectId) {
      // Sync project status based on updated proformas
      const syncedProjects = syncProjectStatus(projectId, updated as Proforma[], projects);
      saveToStorage('erp_projects', syncedProjects, setProjects);

      // Create log text & log activity in category group
      const statusText = status === 'لغو شده' ? 'لغو شده' : status === 'باخته' ? 'باخته' : status;
      const reasonStr = status === 'باخته' && lossReason ? ` (علت باخت: ${lossReason})` : '';
      const logText = `تغییر وضعیت گروهی نسخه‌های پیش‌فاکتور پروژه به «${statusText}» توسط کاربر ${currentUser?.fullName || 'سیستم'}.${reasonStr}`;
      
      autoLogFactActivity(
        projectId,
        'پیش‌فاکتورها و مهندسی فروش',
        logText
      );

      // Ask to complete/close the category group (Completion Prompt)
      const actionMessage = status === 'لغو شده' ? 'لغو شدند' : status === 'باخته' ? 'باخت شدند' : 'بروزرسانی شدند';
      setCompletionPrompt({
        projectId,
        categoryName: 'پیش‌فاکتورها و مهندسی فروش',
        message: `تمامی نسخه‌های پیش‌فاکتور پروژه با موفقیت ${actionMessage}. آیا می‌خواهید وضعیت فعالیت‌های پیش‌فاکتور این پروژه را به «اتمام کار» تغییر دهید؟`
      });
    }
  };

  const addTask = (task: any) => {
    const newTask = { ...task, id: `task-${Date.now()}`, createdAt: new Date().toISOString() };
    const updated = [...tasks, newTask];
    saveToStorage("erp_tasks", updated, setTasks);
    logAction("CREATE", "وظیفه", newTask.id, `ایجاد وظیفه: ${task.title}`);
    processWorkflowRules('task_created', newTask);
  };

  const addModuleNotification = (notif: Omit<ModuleNotification, 'id' | 'timestamp' | 'read'>) => {
    // Exclude self-notifications
    const isSelf = currentUser && (
      currentUser.fullName === notif.responsibleName ||
      currentUser.username === notif.responsibleName
    );
    if (isSelf) return;

    const newNotif: ModuleNotification = {
      ...notif,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: Date.now(),
      read: false
    };
    const updated = [newNotif, ...moduleNotifications];
    saveToStorage("erp_module_notifications", updated, setModuleNotifications);
  };

  const notifyModuleResponsible = (module: string, title: string, description: string, projectId?: string) => {
    const targets: string[] = [];
  
    // 1. The responsible user for the module
    const responsibleName = (settings.moduleResponsibles as any)?.[module];
    if (responsibleName && currentUser?.fullName !== responsibleName) {
      targets.push(responsibleName);
    }
  
    // 2. Admin users (System Admins)
    users.filter(u => u.role === 'admin' || u.isSystemAdmin).forEach(admin => {
      if (admin.fullName === currentUser?.fullName) return;
  
      const pref = (settings.adminNotificationPreferences as any)?.[admin.id];
      const receiveAll = pref ? pref.receiveAll : true;
      const importantProjects = pref ? pref.importantProjectIds : [];
  
      let shouldReceive = false;
      if (receiveAll) {
        shouldReceive = true;
      } else if (projectId && importantProjects.includes(projectId)) {
        shouldReceive = true;
      }
  
      if (shouldReceive && !targets.includes(admin.fullName)) {
        targets.push(admin.fullName);
      }
    });
  
    if (targets.length === 0) return;
  
    targets.forEach(targetName => {
      addModuleNotification({
        module,
        title,
        description,
        responsibleName: targetName
      });
    });
  };

  const processWorkflowRules = (triggerType: string, payload: any) => {
    const activeRules = settings.workflows?.filter(r => r.active && r.triggerType === triggerType) || [];
    
    // Enrich the payload to resolve friendly names from IDs
    const enrichedPayload = { ...payload };

    // 1. Resolve Project Info
    if (enrichedPayload.projectId) {
      const proj = projects.find(p => p.id === enrichedPayload.projectId);
      if (proj) {
        if (!enrichedPayload.projectName) enrichedPayload.projectName = proj.name;
        if (!enrichedPayload.projectCode) enrichedPayload.projectCode = proj.code;
      }
    } else {
      if (triggerType === 'project_created' || triggerType === 'project_status_change') {
        if (!enrichedPayload.projectName) enrichedPayload.projectName = enrichedPayload.name;
        if (!enrichedPayload.projectCode) enrichedPayload.projectCode = enrichedPayload.code;
      }
    }

    // 2. Resolve Customer Info
    if (enrichedPayload.customerId) {
      const cust = customers.find(c => c.id === enrichedPayload.customerId);
      if (cust) {
        if (!enrichedPayload.customerName) enrichedPayload.customerName = cust.name || cust.companyName;
      }
    } else if (triggerType === 'customer_created' || triggerType === 'customer_updated') {
      if (!enrichedPayload.customerName) enrichedPayload.customerName = enrichedPayload.name || enrichedPayload.companyName;
    }

    // 3. Resolve Supplier Info
    if (enrichedPayload.supplierId) {
      const supp = suppliers.find(s => s.id === enrichedPayload.supplierId);
      if (supp) {
        if (!enrichedPayload.supplierName) enrichedPayload.supplierName = supp.companyName || supp.name;
      }
    } else if (triggerType === 'supplier_created') {
      if (!enrichedPayload.supplierName) enrichedPayload.supplierName = enrichedPayload.companyName || enrichedPayload.name;
    }

    // 4. Resolve Product Info
    if (enrichedPayload.productId) {
      const prod = products.find(p => p.id === enrichedPayload.productId);
      if (prod) {
        if (!enrichedPayload.productName) enrichedPayload.productName = prod.name;
      }
    } else if (triggerType === 'product_created' || triggerType === 'product_low_stock') {
      if (!enrichedPayload.productName) enrichedPayload.productName = enrichedPayload.name;
    }

    // 5. Resolve Proforma Info
    if (enrichedPayload.proformaId) {
      const pf = proformas.find(p => p.id === enrichedPayload.proformaId);
      if (pf) {
        if (!enrichedPayload.proformaNumber) enrichedPayload.proformaNumber = pf.proformaNumber;
      }
    }

    // 6. Resolve Purchase Order Info
    if (enrichedPayload.purchaseOrderId) {
      const po = purchaseOrders.find(p => p.id === enrichedPayload.purchaseOrderId);
      if (po) {
        if (!enrichedPayload.poNumber) enrichedPayload.poNumber = po.poNumber;
      }
    }

    // 7. Ensure newStatus / status are in sync
    if (enrichedPayload.newStatus === undefined && enrichedPayload.status !== undefined) {
      enrichedPayload.newStatus = enrichedPayload.status;
    }
    if (enrichedPayload.status === undefined && enrichedPayload.newStatus !== undefined) {
      enrichedPayload.status = enrichedPayload.newStatus;
    }

    // 8. Ensure newOutcome / outcome are in sync
    if (enrichedPayload.newOutcome === undefined && enrichedPayload.outcome !== undefined) {
      enrichedPayload.newOutcome = enrichedPayload.outcome;
    }

    // Supports both single and double curly braces, e.g., {projectName} and {{projectName}}
    const replaceTemplateVars = (template: string, data: any) => {
      if (!template) return '';
      return template.replace(/\{{1,2}([^{}]+)\}{1,2}/g, (match, key) => {
        const k = key.trim();
        return data[k] !== undefined ? String(data[k]) : match;
      });
    };

    for (const rule of activeRules) {
      let match = true;
      for (const cond of rule.conditions) {
        const actualValue = enrichedPayload[cond.field];
        if (cond.operator === 'equals' && String(actualValue) !== String(cond.value)) match = false;
        if (cond.operator === 'not_equals' && String(actualValue) === String(cond.value)) match = false;
        if (cond.operator === 'greater_than' && Number(actualValue) <= Number(cond.value)) match = false;
        if (cond.operator === 'less_than' && Number(actualValue) >= Number(cond.value)) match = false;
      }
      if (match) {
        for (const action of rule.actions) {
          if (action.type === 'create_task') {
            const config = action.taskConfig;
            if (!config) continue;

            let finalAssignedTo = config.assignedTo || 'admin';
            if (finalAssignedTo.startsWith('MODULE_RESPONSIBLE_')) {
              const mod = finalAssignedTo.replace('MODULE_RESPONSIBLE_', '');
              finalAssignedTo = (settings.moduleResponsibles as any)?.[mod] || 'admin';
            } else if (finalAssignedTo === 'SALES_EXPERT') {
              let proj = undefined;
              if (enrichedPayload.projectId) {
                proj = projects.find(p => p.id === enrichedPayload.projectId);
              }
              finalAssignedTo = proj?.salesExpert || enrichedPayload.salesExpert || 'admin';
            }

            const dueDate = addDaysToShamsi(getTodayShamsi(), config.dueDaysOffset || 0);

            addTask({
              title: replaceTemplateVars(config.titleTemplate, enrichedPayload) || `وظیفه خودکار: ${rule.name}`,
              description: replaceTemplateVars(config.descTemplate, enrichedPayload) || '',
              dueDate: dueDate,
              priority: config.priority || 'متوسط',
              status: 'در انتظار',
              assignedTo: finalAssignedTo
            });
          } else if (action.type === 'send_notification') {
            const config = action.notificationConfig;
            if (!config) continue;
            
            let responsible = 'سیستم';
            if ((settings.moduleResponsibles as any)?.[config.module]) {
               responsible = (settings.moduleResponsibles as any)[config.module];
            }

            addModuleNotification({
              module: config.module || 'سیستم',
              title: replaceTemplateVars(config.titleTemplate, enrichedPayload) || rule.name,
              description: replaceTemplateVars(config.descTemplate, enrichedPayload) || '',
              responsibleName: responsible
            });
          }
        }
      }
    }
  };

  const updateTask = (updatedTask: any) => {
    const before = tasks.find(t => t.id === updatedTask.id);
    const updated = tasks.map(t => t.id === updatedTask.id ? updatedTask : t);
    saveToStorage("erp_tasks", updated, setTasks);
    logAction("UPDATE", "وظیفه", updatedTask.id, `بروزرسانی وظیفه: ${updatedTask.title}`);
    processWorkflowRules('task_status_change', { newStatus: updatedTask.status, oldStatus: before?.status, ...updatedTask });
  };
  const deleteTask = (id: string) => {
    const updated = tasks.filter(t => t.id !== id);
    saveToStorage("erp_tasks", updated, setTasks);
    logAction("DELETE", "وظیفه", id, `حذف وظیفه`);
  };

  const addPackagingDelivery = (pd: any) => {
    const seqNum = (settings.documentFormats.packingListStartSeq || 1) + packagingDeliveries.length;
    const projectCode = pd.projectId
      ? (projects.find(p => p.id === pd.projectId)?.code || 'GEN')
      : 'GEN';
    const packingListNumber = formatERPNumber(
      settings.documentFormats.packingListFormat || 'PL-{PROJECT}-{SEQ:3}',
      { seq: seqNum, projectCode }
    );
    const newPd = { ...pd, id: `pd-${Date.now()}`, packingListNumber, createdAt: new Date().toISOString() };
    const updated = [...packagingDeliveries, newPd];
    saveToStorage("erp_packaging_deliveries", updated, setPackagingDeliveries);
    processWorkflowRules('packaging_delivery_created', newPd);
    autoLogFactActivity(newPd.projectId, 'بسته‌بندی و تحویل کالا', `شروع عملیات «${newPd.type === 'PACKAGING' ? 'بسته‌بندی' : 'ارسال و تحویل'}» کالا برای خروج از انبار (شماره پکینگ‌لیست: ${newPd.packingListNumber}، وضعیت فعلی: ${newPd.status}).`, newPd.id);
    notifyModuleResponsible('packagingDelivery', 'ثبت مرحله بسته‌بندی/تحویل جدید', `مرحله جدید ${newPd.type === 'PACKAGING' ? 'بسته‌بندی' : 'ارسال/تحویل'} با وضعیت ${newPd.status} ثبت شد.`, newPd.projectId);

    if (newPd.actualDeliveryDate) {
      setCompletionPrompt({
        projectId: newPd.projectId,
        categoryName: 'بسته‌بندی و تحویل کالا',
        message: `تاریخ تحویل کالا به مشتری (${newPd.actualDeliveryDate}) ثبت شد. آیا می‌خواهید وضعیت دسته فعالیت بسته‌بندی را به «اتمام کار» تغییر دهید؟`
      });
    }
  };
  const updatePackagingDelivery = (updatedPd: any) => {
    const before = packagingDeliveries.find(p => p.id === updatedPd.id);
    const updated = packagingDeliveries.map(p => p.id === updatedPd.id ? updatedPd : p);
    saveToStorage("erp_packaging_deliveries", updated, setPackagingDeliveries);
    autoLogFactActivity(updatedPd.projectId, 'بسته‌بندی و تحویل کالا', `تغییر وضعیت عملیات «${updatedPd.type === 'PACKAGING' ? 'بسته‌بندی' : 'ارسال و تحویل'}» کالا (شماره پکینگ‌لیست: ${updatedPd.packingListNumber}) به «${updatedPd.status}».`, updatedPd.id);
    notifyModuleResponsible('packagingDelivery', 'بروزرسانی مرحله بسته‌بندی/تحویل', `مرحله ${updatedPd.type === 'PACKAGING' ? 'بسته‌بندی' : 'ارسال/تحویل'} به وضعیت ${updatedPd.status} تغییر یافت.`, updatedPd.projectId);

    processWorkflowRules('packaging_delivery_status_change', { newStatus: updatedPd.status, oldStatus: before?.status, ...updatedPd });

    if (!before?.actualDeliveryDate && updatedPd.actualDeliveryDate) {
      setCompletionPrompt({
        projectId: updatedPd.projectId,
        categoryName: 'بسته‌بندی و تحویل کالا',
        message: `تاریخ تحویل کالا به مشتری (${updatedPd.actualDeliveryDate}) ثبت گردید. آیا می‌خواهید وضعیت دسته فعالیت بسته‌بندی را به «اتمام کار» تغییر دهید؟`
      });
    }
  };
  const deletePackagingDelivery = (id: string, deleteLogs: boolean = false) => {
    const record = packagingDeliveries.find(p => p.id === id);
    if (!record) return;

    const updated = packagingDeliveries.filter(p => p.id !== id);
    saveToStorage("erp_packaging_deliveries", updated, setPackagingDeliveries);

    logAction(
      "DELETE",
      "بسته‌بندی و تحویل کالا",
      id,
      `حذف رکورد بسته‌بندی و ارسال (شماره پکینگ لیست: ${record.packingListNumber})`,
      record,
      undefined
    );

    if (deleteLogs) {
      const packingListNum = record.packingListNumber;
      const itemNames = record.items?.map((it: any) => it.itemOrDocName).filter(Boolean) || [];
      removeFactActivitiesForRecord(record.projectId, 'بسته‌بندی و تحویل کالا', record.id, (text) => {
        if (packingListNum && text.includes(packingListNum)) return true;
        if (itemNames.some((name: string) => text.includes(name))) return true;
        return false;
      });
    } else {
      autoLogFactActivity(
        record.projectId,
        'بسته‌بندی و تحویل کالا',
        `رکورد بسته‌بندی و ارسال شماره ${record.packingListNumber} حذف گردید.`
      );
    }
  };

  const addAfterSalesService = (ass: any) => {
    const newAss = { ...ass, id: `ass-${Date.now()}`, createdAt: new Date().toISOString() };
    const updated = [...afterSalesServices, newAss];
    saveToStorage("erp_after_sales_services", updated, setAfterSalesServices);
    autoLogFactActivity(newAss.projectId, 'خدمات پس از فروش', `ثبت درخواست خدمات پس از فروش برای کالای «${newAss.itemName || 'نامشخص'}» (شرح خرابی: ${newAss.issueDescription || '-'}، وضعیت: ${newAss.status}).`, newAss.id);
    notifyModuleResponsible('afterSalesServices', 'ثبت درخواست خدمات پس از فروش جدید', `درخواست خدمات جدید برای کالا ${newAss.itemName || ''} با وضعیت ${newAss.status} ثبت شد.`, newAss.projectId);
    processWorkflowRules('after_sales_service_created', newAss);
  };
  const updateAfterSalesService = (updatedAss: any) => {
    const before = afterSalesServices.find(a => a.id === updatedAss.id);
    const updated = afterSalesServices.map(a => a.id === updatedAss.id ? updatedAss : a);
    saveToStorage("erp_after_sales_services", updated, setAfterSalesServices);
    autoLogFactActivity(updatedAss.projectId, 'خدمات پس از فروش', `تغییر وضعیت درخواست خدمات پس از فروش کالای «${updatedAss.itemName || 'نامشخص'}» به «${updatedAss.status}» (اقدامات انجام‌شده: ${updatedAss.actionsTaken || '-'}).`, updatedAss.id);
    notifyModuleResponsible('afterSalesServices', 'بروزرسانی درخواست خدمات پس از فروش', `درخواست خدمات برای کالا ${updatedAss.itemName || ''} به وضعیت ${updatedAss.status} تغییر یافت.`, updatedAss.projectId);

    processWorkflowRules('after_sales_service_status_change', { newStatus: updatedAss.status, oldStatus: before?.status, ...updatedAss });

    if (before?.status !== updatedAss.status && updatedAss.status === 'تحویل داده شده') {
      setCompletionPrompt({
        projectId: updatedAss.projectId,
        categoryName: 'خدمات پس از فروش',
        message: `کالای ${updatedAss.itemName} تحویل مشتری داده شد. آیا می‌خواهید وضعیت دسته فعالیت مربوط به خدمات پس از فروش را به «اتمام کار» تغییر دهید؟`
      });
    }
  };
  const deleteAfterSalesService = (id: string, deleteLogs: boolean = false) => {
    const record = afterSalesServices.find(a => a.id === id);
    if (!record) return;

    const updated = afterSalesServices.filter(a => a.id !== id);
    saveToStorage("erp_after_sales_services", updated, setAfterSalesServices);

    logAction(
      "DELETE",
      "خدمات پس از فروش",
      id,
      `حذف رکورد خدمات پس از فروش (کالا: ${record.itemName})`,
      record,
      undefined
    );

    if (deleteLogs) {
      const itemName = record.itemName;
      const subItemNames = record.items?.map((it: any) => it.productName).filter(Boolean) || [];
      const allItemNames = [itemName, ...subItemNames].filter(Boolean);
      removeFactActivitiesForRecord(record.projectId, 'خدمات پس از فروش', record.id, (text) =>
        allItemNames.some((name: string) => text.includes(name))
      );
    } else {
      autoLogFactActivity(
        record.projectId,
        'خدمات پس از فروش',
        `درخواست خدمات پس از فروش مربوط به کالای ${record.itemName} حذف گردید.`
      );
    }
  };

  const addSupplierInquiry = (si: any): any => {
    const newSi = { ...si, id: `si-${Date.now()}`, createdAt: new Date().toISOString() };
    const updated = [...supplierInquiries, newSi];
    saveToStorage("erp_supplier_inquiries", updated, setSupplierInquiries);
    
    const supplierObj = suppliers.find(s => s.id === newSi.supplierId);
    const suppName = supplierObj ? (supplierObj.companyName || supplierObj.name) : (newSi.supplierName || newSi.supplierId || '');
    autoLogFactActivity(newSi.projectId, 'استعلام قیمت تأمین‌کنندگان', `ثبت درخواست استعلام قیمت از تأمین‌کننده «${suppName}» (مبلغ اعلامی: ${newSi.price?.toLocaleString('fa-IR') || 0} ${newSi.currency || 'ریال'}، وضعیت: ${newSi.status}).`, newSi.id);
    notifyModuleResponsible('supplierInquiries', 'ثبت استعلام قیمت جدید', `استعلام قیمت جدید برای تأمین‌کننده «${suppName}» ثبت شد.`, newSi.projectId);
    processWorkflowRules('supplier_inquiry_created', newSi);
    return newSi;
  };
  const updateSupplierInquiry = (updatedSi: any) => {
    const oldSi = supplierInquiries.find(s => s.id === updatedSi.id);
    const updated = supplierInquiries.map(s => s.id === updatedSi.id ? updatedSi : s);
    saveToStorage("erp_supplier_inquiries", updated, setSupplierInquiries);
    
    const supplierObj = suppliers.find(s => s.id === updatedSi.supplierId);
    const suppName = supplierObj ? (supplierObj.companyName || supplierObj.name) : (updatedSi.supplierName || updatedSi.supplierId || '');
    autoLogFactActivity(updatedSi.projectId, 'استعلام قیمت تأمین‌کنندگان', `بروزرسانی وضعیت استعلام قیمت از تأمین‌کننده «${suppName}» به «${updatedSi.status}» (مبلغ اعلامی: ${updatedSi.price?.toLocaleString('fa-IR') || 0} ${updatedSi.currency || 'ریال'}).`, updatedSi.id);
    processWorkflowRules('supplier_inquiry_status_change', { newStatus: updatedSi.status, oldStatus: oldSi?.status, ...updatedSi });
  };
  const deleteSupplierInquiry = (id: string, deleteLogs: boolean = false) => {
    const record = supplierInquiries.find(s => s.id === id);
    if (!record) return;

    const updated = supplierInquiries.filter(s => s.id !== id);
    saveToStorage("erp_supplier_inquiries", updated, setSupplierInquiries);

    logAction(
      "DELETE",
      "استعلام قیمت تأمین‌کنندگان",
      id,
      `حذف استعلام قیمت (تأمین‌کننده: ${record.supplierName || record.supplierId})`,
      record,
      undefined
    );

    if (deleteLogs) {
      const supplierName = record.supplierName;
      const itemNames = record.items?.map((it: any) => it.name).filter(Boolean) || [];
      const keywords = [supplierName, ...itemNames].filter(Boolean);
      removeFactActivitiesForRecord(record.projectId, 'استعلام قیمت تأمین‌کنندگان', record.id, (text) =>
        keywords.some((name: string) => text.includes(name))
      );
    } else {
      autoLogFactActivity(
        record.projectId,
        'استعلام قیمت تأمین‌کنندگان',
        `استعلام قیمت مربوط به تأمین‌کننده ${record.supplierName} حذف گردید.`
      );
    }
  };

  const updatePurchaseOrderStatus = (id: string, status: any) => {
    const po = purchaseOrders.find(p => p.id === id);
    if (po) {
      updatePurchaseOrder({ ...po, status });
    }
  };

  const updateExchangeRate = (id: string, newRateValue: number) => {
    const updated = exchangeRates.map(r => r.id === id ? { ...r, rateToRIYAL: newRateValue, lastUpdated: new Date().toISOString() } : r);
    saveToStorage("erp_exchange_rates", updated, setExchangeRates);
  };

  const markModuleNotificationAsRead = (id: string) => {
    const updated = moduleNotifications.map(n => n.id === id ? { ...n, read: true } : n);
    saveToStorage("erp_module_notifications", updated, setModuleNotifications);
  };
  const markAllModuleNotificationsAsRead = () => {
    const updated = moduleNotifications.map(n => ({ ...n, read: true }));
    saveToStorage("erp_module_notifications", updated, setModuleNotifications);
  };

  const markItemsAsRead = (ids: string[]) => {
    const newItems = Array.from(new Set([...readItems, ...ids]));
    saveToStorage("erp_read_items", newItems, setReadItems);
  };

  
  
  

  const triggerMilestonesForEvent = (projectId: string, eventType: 'category_start' | 'category_complete', categoryName: string) => {
    const normalize = (str: string) => str ? str.replace(/[\s‌]/g, "").trim() : "";
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const updatedMilestones = (project.milestones || []).map(m => {
      const isMatch = m.triggerType === eventType && m.triggerCategoryName && normalize(m.triggerCategoryName) === normalize(categoryName);
      if (isMatch && !m.isCompleted) {
        return {
          ...m,
          isCompleted: true,
          completedAt: getTodayShamsi()
        };
      }
      return m;
    });

    const milestoneChanged = JSON.stringify(project.milestones) !== JSON.stringify(updatedMilestones);
    if (milestoneChanged) {
      updateProject({
        ...project,
        milestones: updatedMilestones
      });
    }
  };

  const completeCategoryGroup = (projectId: string, categoryName: string) => {
    const getMappedCategoryName = (name: string): string => {
      const norm = (str: string) => str ? str.replace(/[\s\u200c]/g, "").trim().toLowerCase() : "";
      const n = norm(name);
      if (n === norm('پیش‌فاکتور') || n === norm('پیش‌فاکتورها') || n === norm('پیش‌فاکتورها و مهندسی فروش')) {
        return 'پیش‌فاکتورها و مهندسی فروش';
      }
      if (n === norm('سفارش خرید') || n === norm('سفارشات خرید تامین‌کنندگان') || n === norm('سفارشات خرید تامین کنندگان')) {
        return 'سفارشات خرید تامین‌کنندگان';
      }
      if (n === norm('استعلام قیمت از تامین‌کننده‌ها') || n === norm('استعلام قیمت تأمین‌کنندگان') || n === norm('استعلام قیمت تامین کنندگان')) {
        return 'استعلام قیمت تأمین‌کنندگان';
      }
      if (n === norm('مالی') || n === norm('تراکنش‌های مالی و پرداخت‌ها') || n === norm('تراکنش های مالی و پرداخت ها')) {
        return 'تراکنش‌های مالی و پرداخت‌ها';
      }
      return name;
    };

    const finalCategoryName = getMappedCategoryName(categoryName);
    const normalize = (str: string) => str.replace(/[\s‌]/g, "").trim();
    setProjectCategoryGroups((prevGroups) => {
      const updatedGroups = prevGroups.map((g) => {
        if (
          g.projectId === projectId &&
          normalize(g.categoryName) === normalize(finalCategoryName)
        ) {
          return {
            ...g,
            status: "اتمام کار",
            endDate: getTodayShamsi(),
          };
        }
        return g;
      });
      saveToServer("erp_project_category_groups", updatedGroups);
      return updatedGroups;
    });

    // Auto trigger completion milestones
    triggerMilestonesForEvent(projectId, 'category_complete', categoryName);
  };

  const addProjectCategoryGroup = (projectIdOrGroup: any, categoryId?: string, categoryName?: string, startDate?: string) => {
    let newGroup: any;
    let pId = "";
    let catName = "";

    if (typeof projectIdOrGroup === 'object' && projectIdOrGroup !== null) {
      newGroup = { 
        ...projectIdOrGroup, 
        id: `catgrp-${Date.now()}`, 
        createdAt: new Date().toISOString(),
        startDate: projectIdOrGroup.startDate || startDate || getTodayShamsi()
      };
      pId = projectIdOrGroup.projectId;
      catName = projectIdOrGroup.categoryName;
    } else {
      newGroup = {
        projectId: projectIdOrGroup,
        categoryId: categoryId,
        categoryName: categoryName,
        status: 'جاری',
        activities: [],
        id: `catgrp-${Date.now()}`,
        createdAt: new Date().toISOString(),
        startDate: startDate || getTodayShamsi()
      };
      pId = projectIdOrGroup;
      catName = categoryName || "";
    }

    const updated = [...projectCategoryGroups, newGroup];
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);

    // Auto trigger start milestones
    if (pId && catName) {
      triggerMilestonesForEvent(pId, 'category_start', catName);
    }

    return { success: true };
  };

  const updateProjectCategoryGroup = (group: any) => {
    const updated = projectCategoryGroups.map(g => g.id === group.id ? group : g);
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
  };
  const deleteProjectCategoryGroup = (id: string) => {
    const updated = projectCategoryGroups.filter(g => g.id !== id);
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
  };
  const completeProjectCategoryGroup = (categoryGroupId: string, createdBy?: string) => {
    let pId = "";
    let catName = "";

    setProjectCategoryGroups(prevGroups => {
      const updatedGroups = prevGroups.map(g => {
        if (g.id === categoryGroupId) {
          pId = g.projectId;
          catName = g.categoryName;
          const newActivity = {
            id: 'act-' + Date.now(),
            createdAt: new Date().toISOString(),
            date: getTodayShamsi(),
            text: `اتمام کار دسته‌بندی «${g.categoryName}»`,
            description: 'اتمام کار',
            createdBy: createdBy || 'سیستم',
            type: 'اتمام کار'
          };
          return {
            ...g,
            status: "اتمام کار",
            endDate: getTodayShamsi(),
            activities: [...(g.activities || []), newActivity]
          };
        }
        return g;
      });
      saveToServer("erp_project_category_groups", updatedGroups);
      return updatedGroups;
    });

    if (pId && catName) {
      triggerMilestonesForEvent(pId, 'category_complete', catName);
    }
  };
  const resumeProjectCategoryGroup = (categoryGroupId: string, createdBy?: string) => {
    const updated = projectCategoryGroups.map(g => {
      if (g.id === categoryGroupId) {
        const newActivity = {
          id: 'act-' + Date.now(),
          createdAt: new Date().toISOString(),
          date: getTodayShamsi(),
          text: `بازگشایی مجدد دسته‌بندی «${g.categoryName}»`,
          description: 'بازگشایی مجدد',
          createdBy: createdBy || currentUser?.fullName || 'سیستم',
          type: 'بازگشایی مجدد'
        };
        return {
          ...g,
          status: "جاری",
          completedAt: undefined,
          endDate: undefined,
          activities: [...(g.activities || []), newActivity]
        };
      }
      return g;
    });
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
  };

  
  


  const addProjectActivity = (
    projectId: string,
    categoryGroupId: string,
    text: string,
    attachment: any | null,
    referral: any | null,
    createdBy?: string
  ) => {
    const updated = projectCategoryGroups.map(g => {
      if (g.id === categoryGroupId) {
        const newActivity = {
          id: 'act-' + Date.now(),
          text,
          createdAt: new Date().toISOString(),
          attachment,
          referral: referral ? {
            id: referral.id || 'ref-' + Date.now(),
            assignedTo: referral.assignedTo,
            actionRequired: referral.actionRequired,
            assignedBy: referral.assignedBy,
            createdAt: referral.createdAt || new Date().toISOString(),
            status: referral.status || 'در انتظار اقدام',
            response: referral.response || null,
            messages: referral.messages || []
          } : null,
          createdBy: createdBy || currentUser?.fullName || "کاربر سیستم"
        };

        if (referral && referral.assignedTo) {
          addModuleNotification({
            module: 'projects',
            title: 'ارجاع جدید',
            description: `یک کار جدید برای شما ارجاع شده است: ${referral.actionRequired}`,
            responsibleName: referral.assignedTo
          });
        }

        if (newActivity.referral) {
          processWorkflowRules('referral_created', newActivity.referral);
        }

        // Notify category responsible:
        const cat = settings.activityCategories?.find(c => c.id === g.categoryId);
        const responsibleName = cat?.responsibleUserId;
        const proj = projects.find(p => p.id === projectId);
        const projectName = proj ? proj.name : "نامشخص";
        const creatorName = createdBy || currentUser?.fullName || 'سیستم';
        
        if (responsibleName && responsibleName !== creatorName) {
          addModuleNotification({
            module: 'projects',
            title: `فعالیت جدید در ${g.categoryName}`,
            description: `ثبت فعالیت جدید در دسته‌بندی "${g.categoryName}" پروژه "${projectName}" توسط ${creatorName}: ${text}`,
            responsibleName: responsibleName
          });
        }

        return { ...g, activities: [...(g.activities || []), newActivity] };
      }
      return g;
    });
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
  };

  const updateProjectActivity = (
    projectId: string,
    categoryGroupId: string,
    activityId: string,
    text: string
  ) => {
    const updated = projectCategoryGroups.map(g => {
      if (g.id === categoryGroupId) {
        // Find existing activity to update
        const activities = (g.activities || []).map((a: any) => {
          if (a.id === activityId) {
            return { ...a, text };
          }
          return a;
        });

        // Notify category responsible:
        const cat = settings.activityCategories?.find(c => c.id === g.categoryId);
        const responsibleName = cat?.responsibleUserId;
        const proj = projects.find(p => p.id === projectId);
        const projectName = proj ? proj.name : "نامشخص";
        const editorName = currentUser?.fullName || "کاربر سیستم";

        if (responsibleName && responsibleName !== editorName) {
          addModuleNotification({
            module: 'projects',
            title: `ویرایش فعالیت در ${g.categoryName}`,
            description: `فعالیت دسته‌بندی "${g.categoryName}" پروژه "${projectName}" توسط ${editorName} ویرایش شد: ${text}`,
            responsibleName: responsibleName
          });
        }

        return { ...g, activities };
      }
      return g;
    });
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
  };

  const deleteProjectActivity = (
    projectId: string,
    categoryGroupId: string,
    activityId: string
  ) => {
    const updated = projectCategoryGroups.map(g => {
      if (g.id === categoryGroupId) {
        const activityToDelete = (g.activities || []).find((a: any) => a.id === activityId);
        const activities = (g.activities || []).filter((a: any) => a.id !== activityId);

        // Notify category responsible:
        const cat = settings.activityCategories?.find(c => c.id === g.categoryId);
        const responsibleName = cat?.responsibleUserId;
        const proj = projects.find(p => p.id === projectId);
        const projectName = proj ? proj.name : "نامشخص";
        const deleterName = currentUser?.fullName || "کاربر سیستم";

        if (responsibleName && responsibleName !== deleterName && activityToDelete) {
          addModuleNotification({
            module: 'projects',
            title: `حذف فعالیت از ${g.categoryName}`,
            description: `یک فعالیت از دسته‌بندی "${g.categoryName}" پروژه "${projectName}" توسط ${deleterName} حذف شد. متن فعالیت حذف شده: ${activityToDelete.text}`,
            responsibleName: responsibleName
          });
        }

        return { ...g, activities };
      }
      return g;
    });
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
  };

  const toggleReferralStatus = (categoryGroupId: string, activityId: string) => {
    let changedReferral: any = null;
    let oldStatus = '';
    let activityText = '';
    const updated = projectCategoryGroups.map(g => {
      if (g.id === categoryGroupId) {
        return {
          ...g,
          activities: (g.activities || []).map((a: any) => {
            if (a.id === activityId && a.referral) {
              oldStatus = a.referral.status;
              activityText = a.text;
              const newStatus = a.referral.status === "انجام شده" ? "در انتظار اقدام" : "انجام شده";
              changedReferral = {
                ...a.referral,
                status: newStatus
              };
              return {
                ...a,
                referral: changedReferral
              };
            }
            return a;
          })
        };
      }
      return g;
    });
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
    if (changedReferral) {
      processWorkflowRules('referral_status_change', { newStatus: changedReferral.status, oldStatus, ...changedReferral });
      
      // Notify category responsible:
      const group = projectCategoryGroups.find(g => g.id === categoryGroupId);
      if (group) {
        const cat = settings.activityCategories?.find(c => c.id === group.categoryId);
        const responsibleName = cat?.responsibleUserId;
        const proj = projects.find(p => p.id === group.projectId);
        const projectName = proj ? proj.name : "نامشخص";
        const editorName = currentUser?.fullName || "کاربر سیستم";

        if (responsibleName && responsibleName !== editorName) {
          addModuleNotification({
            module: 'projects',
            title: `تغییر وضعیت ارجاع در ${group.categoryName}`,
            description: `وضعیت ارجاع فعالیت "${activityText}" در دسته‌بندی "${group.categoryName}" پروژه "${projectName}" توسط ${editorName} به "${changedReferral.status}" تغییر یافت.`,
            responsibleName: responsibleName
          });
        }
      }
    }
  };

  const respondToReferral = (
    categoryGroupId: string,
    activityId: string,
    responseText: string,
    responderName: string,
    attachment?: any,
    markAsDone?: boolean,
    forwardTo?: string
  ) => {
    let changedReferral: any = null;
    let oldStatus = '';
    let activityText = '';
    const updated = projectCategoryGroups.map(g => {
      if (g.id === categoryGroupId) {
        return {
          ...g,
          activities: (g.activities || []).map((a: any) => {
            if (a.id === activityId && a.referral) {
              oldStatus = a.referral.status;
              activityText = a.text;
              let updatedReferral = { ...a.referral };
              if (responseText || attachment) {
                const newMessage = {
                  id: 'msg-' + Date.now(),
                  text: responseText,
                  responder: responderName,
                  createdAt: new Date().toISOString(),
                  attachment: attachment || null
                };
                updatedReferral.messages = [...(updatedReferral.messages || []), newMessage];
                updatedReferral.response = newMessage;
              }
              if (markAsDone) {
                updatedReferral.status = "انجام شده";
              }
              if (forwardTo) {
                updatedReferral.assignedTo = forwardTo;
                updatedReferral.status = "در انتظار اقدام";
              }
              changedReferral = updatedReferral;
              return { ...a, referral: updatedReferral };
            }
            return a;
          })
        };
      }
      return g;
    });
    saveToStorage("erp_project_category_groups", updated, setProjectCategoryGroups);
    if (changedReferral) {
      processWorkflowRules('referral_status_change', { newStatus: changedReferral.status, oldStatus, ...changedReferral });

      // Notify category responsible:
      const group = projectCategoryGroups.find(g => g.id === categoryGroupId);
      if (group) {
        const cat = settings.activityCategories?.find(c => c.id === group.categoryId);
        const responsibleName = cat?.responsibleUserId;
        const proj = projects.find(p => p.id === group.projectId);
        const projectName = proj ? proj.name : "نامشخص";
        const responder = currentUser?.fullName || responderName || "کاربر سیستم";

        let actionDesc = '';
        if (responseText) {
          actionDesc += ` پاسخ ثبت کرد: "${responseText}"`;
        }
        if (markAsDone) {
          actionDesc += (actionDesc ? ' و ' : ' ') + `کار را انجام شده علامت زد`;
        }
        if (forwardTo) {
          actionDesc += (actionDesc ? ' و ' : ' ') + `کار را به ${forwardTo} ارجاع داد`;
        }

        if (responsibleName && responsibleName !== responder) {
          addModuleNotification({
            module: 'projects',
            title: `پاسخ ارجاع در ${group.categoryName}`,
            description: `روی ارجاع فعالیت "${activityText}" در دسته‌بندی "${group.categoryName}" پروژه "${projectName}"، ${responder}${actionDesc}.`,
            responsibleName: responsibleName
          });
        }
      }
    }
  };
  return {
    customers,
    products,
    suppliers,
    exchangeRates,
    projects,
    proformas,
    purchaseOrders,
    transactions,
    inventoryTransactions,
    tasks,
    packagingDeliveries,
    afterSalesServices,
    supplierInquiries,
    moduleNotifications,
    projectCategoryGroups,
    readItems,
    settings,
    users,
    currentUser,
    auditLogs,
    isInitialized,
    userRole,
    completionPrompt,
    setCompletionPrompt,
    completeCategoryGroup,
    addCustomer, updateCustomer, deleteCustomer, batchUpdateCustomers,
    addProduct, updateProduct, deleteProduct, batchImportProducts, adjustProductStock,
    addSupplier, updateSupplier, deleteSupplier, batchImportSuppliers,
    addTransaction, updateTransaction, deleteTransaction,
    addPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, updatePurchaseOrderStatus,
    addProject, updateProject, deleteProject,
    addProforma, updateProforma, deleteProforma, updateProformaStatus, batchUpdateProjectProformasStatus,
    addProjectActivity, updateProjectActivity, deleteProjectActivity,
    addProjectCategoryGroup, updateProjectCategoryGroup, deleteProjectCategoryGroup, completeProjectCategoryGroup, resumeProjectCategoryGroup,
    addTask, updateTask, deleteTask,
    addPackagingDelivery, updatePackagingDelivery, deletePackagingDelivery,
    addAfterSalesService, updateAfterSalesService, deleteAfterSalesService,
    addSupplierInquiry, updateSupplierInquiry, deleteSupplierInquiry,
    markModuleNotificationAsRead, markAllModuleNotificationsAsRead, markItemsAsRead,
    toggleReferralStatus, respondToReferral,
    updateExchangeRate, fetchRatesFromAPI,
    changeRole,


    addUser: (user: Omit<User, "id">) => {
      const newUser: User = {
        ...user,
        id: `user-${Date.now()}`,
      };
      const updated = [...users, newUser];
      saveToStorage("erp_users", updated, setUsers);
      return newUser;
    },
    updateUser: (updatedUser: User) => {
      const updated = users.map((u) =>
        u.id === updatedUser.id ? updatedUser : u,
      );
      saveToStorage("erp_users", updated, setUsers);
      if (currentUser && currentUser.id === updatedUser.id) {
        saveToStorage("erp_current_user", updatedUser, setCurrentUser);
        setUserRole(updatedUser.role);
        localStorage.setItem("erp_simulated_role", updatedUser.role);
      }
    },
    deleteUser: (id: string) => {
      const updated = users.filter((u) => u.id !== id);
      saveToStorage("erp_users", updated, setUsers);
    },
    login: async (
      username: string,
      password?: string,
    ): Promise<{
      success: boolean;
      mustChangePassword?: boolean;
      message?: string;
    }> => {
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json();
        if (res.ok && data.success && data.user) {
          if (data.mustChangePassword) {
            return { success: true, mustChangePassword: true };
          }
          saveToStorage("erp_current_user", data.user, setCurrentUser);
          setUserRole(data.user.role);
          localStorage.setItem("erp_simulated_role", data.user.role);
          return { success: true, mustChangePassword: false };
        } else {
          return {
            success: false,
            message: data.message || "نام کاربری یا رمز ورود اشتباه است.",
          };
        }
      } catch (err) {
        console.error("Login error", err);
      

  
  
  
    return { success: false, message: "خطا در برقراری ارتباط با سرور." };
      }
    },
    loginWithUser: (user: any) => {
      saveToStorage("erp_current_user", user, setCurrentUser);
      setUserRole(user.role);
      localStorage.setItem("erp_simulated_role", user.role);
    },
    logout: () => {
      localStorage.removeItem("erp_current_user");
      setCurrentUser(null);
    },

    updateSettings: (newSettings: ERPSettings) => {
      saveToStorage("erp_settings", newSettings, setSettings);
      logAction("UPDATE", "سیستم", "تنظیمات نرم‌افزار", "تنظیمات نرم‌افزار بروزرسانی شد.");
    },
  };
}
