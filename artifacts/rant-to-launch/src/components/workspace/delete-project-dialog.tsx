import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function DeleteProjectDialog({
  open,
  projectName,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  projectName: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-none border-2">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif">
            Delete this project?
          </AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;
            <span className="font-bold text-foreground">
              {projectName || "This project"}
            </span>
            &rdquo; and every asset card it generated will be permanently
            removed. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-none" disabled={isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-confirm-delete-project"
            className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {isPending ? "Deleting..." : "Delete project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
