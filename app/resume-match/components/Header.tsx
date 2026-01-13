"use client";

import React from "react";
import { MatchModelType } from "../types";
import styles from "../resume-match.module.scss";

interface HeaderProps {
    selectedModel: MatchModelType;
    onModelChange: (model: MatchModelType) => void;
}

export const Header: React.FC<HeaderProps> = ({
    selectedModel,
    onModelChange,
}) => {
    const scrollTo = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    };

    return (
        <header className={styles.header}>
            <div className={styles.inner}>
                <div className={styles["logo-box"]}>
                    <div className={styles.icon}>
                        <span>R</span>
                    </div>
                    <span className={styles.title}>
                        智能简历匹配系统
                    </span>
                </div>
                <div className={styles.nav}>
                    {/* 模型选择下拉框 */}
                    <div className={styles["model-select"]}>
                        <label>匹配模型：</label>
                        <select
                            value={selectedModel}
                            onChange={(e) =>
                                onModelChange(e.target.value as MatchModelType)
                            }
                        >
                            <option value="gemini-3-flash-preview">⚡ Gemini 3 Flash</option>
                            <option value="gemini-3-pro-preview">🧠 Gemini 3 Pro</option>
                        </select>
                    </div>
                </div>
            </div>
        </header>
    );
};
