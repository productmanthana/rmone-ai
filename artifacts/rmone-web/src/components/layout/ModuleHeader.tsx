import type { CSSProperties, ElementType, ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

type BackLink = {
  href: string;
  label: string;
};

export function ModuleHeader({
  title,
  section,
  context,
  icon: Icon,
  backTo,
  actions,
  status,
  sticky = false,
  style,
}: {
  title: string;
  section?: string;
  context?: ReactNode;
  icon?: ElementType;
  backTo?: BackLink;
  actions?: ReactNode;
  status?: ReactNode;
  sticky?: boolean;
  style?: CSSProperties;
}) {
  return (
    <header
      className="rm-module-header"
      style={{
        position: sticky ? "sticky" : "relative",
        top: sticky ? 0 : undefined,
        zIndex: sticky ? 20 : undefined,
        ...style,
      }}
    >
      <div className="rm-module-header__identity">
        {backTo && (
          <Link className="rm-module-header__back" href={backTo.href}>
            <ArrowLeft aria-hidden="true" />
            <span>{backTo.label}</span>
          </Link>
        )}
        <div className="rm-module-header__title-row">
          {Icon && (
            <span className="rm-module-header__icon" aria-hidden="true">
              <Icon />
            </span>
          )}
          <div className="rm-module-header__copy">
            {section && <div className="rm-module-header__section">{section}</div>}
            <h1>{title}</h1>
            {context && <div className="rm-module-header__context">{context}</div>}
          </div>
        </div>
      </div>
      {(actions || status) && (
        <div className="rm-module-header__right">
          {actions && <div className="rm-module-header__actions">{actions}</div>}
          {status}
        </div>
      )}
    </header>
  );
}