import {
  Archive,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  Ban,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CirclePlus,
  CircleDollarSign,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FilePenLine,
  FileText,
  GripVertical,
  History,
  Inbox,
  PackageCheck,
  Pencil,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  Warehouse,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";

type MuiIconCompatProps = {
  className?: string;
  color?: string;
  fontSize?: "inherit" | "large" | "medium" | "small" | string;
  style?: CSSProperties;
  sx?: CSSProperties;
};

function createIcon(Icon: LucideIcon) {
  return function MuiIconCompat({ className, color, fontSize = "medium", style, sx }: MuiIconCompatProps) {
    const size = fontSize === "small" ? 16 : fontSize === "large" ? 22 : fontSize === "inherit" ? "1em" : 18;
    return (
      <Icon
        className={className}
        size={size}
        strokeWidth={2.1}
        style={{ color, ...sx, ...style }}
      />
    );
  };
}

export const AddCircleOutlineOutlinedIcon = createIcon(CirclePlus);
export const ArchiveOutlinedIcon = createIcon(Archive);
export const ArrowBackOutlinedIcon = createIcon(ArrowLeft);
export const BlockOutlinedIcon = createIcon(Ban);
export const CalendarMonthOutlinedIcon = createIcon(CalendarDays);
export const CheckCircleOutlineOutlinedIcon = createIcon(CheckCircle2);
export const ClearOutlinedIcon = createIcon(X);
export const CloseIcon = createIcon(X);
export const CompareArrowsOutlinedIcon = createIcon(ArrowLeftRight);
export const ContentCopyOutlinedIcon = createIcon(Copy);
export const DeleteOutlineOutlinedIcon = createIcon(Trash2);
export const DragIndicatorOutlinedIcon = createIcon(GripVertical);
export const DriveFileRenameOutlineOutlinedIcon = createIcon(FilePenLine);
export const EditOutlinedIcon = createIcon(Pencil);
export const ExpandLessOutlinedIcon = createIcon(ChevronUp);
export const ExpandMoreOutlinedIcon = createIcon(ChevronDown);
export const ExpandMoreRoundedIcon = createIcon(ChevronDown);
export const FactCheckOutlinedIcon = createIcon(PackageCheck);
export const FileDownloadOutlinedIcon = createIcon(Download);
export const HistoryOutlinedIcon = createIcon(History);
export const Inventory2OutlinedIcon = createIcon(Boxes);
export const LocalShippingOutlinedIcon = createIcon(Truck);
export const MoveToInboxOutlinedIcon = createIcon(Inbox);
export const OpenInNewRoundedIcon = createIcon(ExternalLink);
export const OutboxOutlinedIcon = createIcon(Send);
export const PaidOutlinedIcon = createIcon(CircleDollarSign);
export const PictureAsPdfOutlinedIcon = createIcon(FileText);
export const RefreshOutlinedIcon = createIcon(RefreshCw);
export const SearchOutlinedIcon = createIcon(Search);
export const SwapVertRoundedIcon = createIcon(ArrowUpDown);
export const TrendingDownOutlinedIcon = createIcon(TrendingDown);
export const TrendingFlatOutlinedIcon = createIcon(ArrowLeftRight);
export const TrendingUpOutlinedIcon = createIcon(TrendingUp);
export const TuneOutlinedIcon = createIcon(SlidersHorizontal);
export const VisibilityOutlinedIcon = createIcon(Eye);
export const WarehouseOutlinedIcon = createIcon(Warehouse);
