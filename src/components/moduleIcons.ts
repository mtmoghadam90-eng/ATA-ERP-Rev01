import {
  ArrowDownLeft, ArrowLeftRight, Boxes, Briefcase, CheckSquare, FileText,
  LayoutDashboard, MessageSquare, Package, Settings, ShieldCheck, ShoppingCart,
  Truck, Users, Wrench,
} from "lucide-react";
import type { AppModuleId } from "../appModules";

/**
 * A module's icon, kept apart from the catalogue so the catalogue stays free of
 * React and can be read by `seedData.ts` and by the scripts that import it.
 *
 * The `Record<AppModuleId, …>` is the point: adding a module to `APP_MODULES`
 * and stopping there fails `npm run lint`, and `deploy.ps1` refuses to deploy
 * when lint fails. That is what turns "remember to update the other lists" into
 * something nobody has to remember.
 */
export const MODULE_ICONS: Record<AppModuleId, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  customers: Users,
  projects: Briefcase,
  proformas: FileText,
  products: Package,
  suppliers: Truck,
  supplierInquiries: ArrowLeftRight,
  purchaseOrders: ShoppingCart,
  packagingDelivery: Boxes,
  afterSalesServices: Wrench,
  transactions: ArrowDownLeft,
  tasks: CheckSquare,
  messaging: MessageSquare,
  users: ShieldCheck,
  settings: Settings,
};
