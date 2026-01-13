"use client";

import React, { useRef } from "react";
import styles from "../resume-match.module.scss";

interface FileUploadProps {
    onUpload: (files: File[]) => void;
    accept: string;
    multiple?: boolean;
    title: string;
    subtitle: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
    onUpload,
    accept,
    multiple = true,
    title,
    subtitle,
}) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            onUpload(Array.from(e.target.files));
        }
    };

    return (
        <div
            onClick={() => inputRef.current?.click()}
            className={styles["file-upload"]}
        >
            <input
                type="file"
                ref={inputRef}
                onChange={handleChange}
                accept={accept}
                multiple={multiple}
                className="hidden" /* global helper or keep as simple display none style */
                style={{ display: 'none' }}
            />
            <div className={styles["icon-wrapper"]}>
                <svg
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M12 4v16m8-8H4"
                    />
                </svg>
            </div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
        </div>
    );
};
