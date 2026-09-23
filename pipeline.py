#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
=======================================================================
笔记本 16:10 4K 动态壁纸一键自动化生成流水线 (Laptop Wallpaper Pipeline)
=======================================================================
功能:
1. 智能画幅裁切: 针对 16:10 严格居中裁切，杜绝拉伸挤压变形
2. GPU 神经超分: 调用本地 Real-ESRGAN (animevideov3 + TTA 8重采样)，彻底消灭毛边与人造黑边
3. 4K 极清降采样: 7680x4800 超采样缓冲 -> 3840x2400 (真 16:10 4K)
4. 动态壁纸自动打包: 自动生成包含优雅慢速落樱、库洛魔法星尘与 2.5D 视差的独立工程包
"""

import os
import sys
import argparse
import subprocess
import webbrowser
from PIL import Image

if sys.platform == "win32":
    import io
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
INPUT_DIR = os.path.join(CURRENT_DIR, "input")
OUTPUT_DIR = os.path.join(CURRENT_DIR, "output")
TOOLS_DIR = os.path.join(CURRENT_DIR, "tools")
REAL_ESRGAN_EXE = os.path.join(TOOLS_DIR, "realesrgan-ncnn-vulkan.exe")
TEMPLATE_DIR = os.path.join(CURRENT_DIR, "sample_sakura_wallpaper")

DEFAULT_TARGET_W = 3840
DEFAULT_TARGET_H = 2400

def fit_to_aspect_ratio(img_pil, target_aspect=1.6):
    """
    智能几何居中裁切，确保输出严格符合目标长宽比 (默认 16:10 = 1.6)，杜绝非等比拉伸
    """
    w, h = img_pil.size
    current_aspect = w / float(h)
    
    # 允许 1% 极小误差直接跳过
    if abs(current_aspect - target_aspect) < 0.01:
        return img_pil

    if current_aspect > target_aspect:
        # 过宽 (如 16:9 = 1.778)，从左右两侧居中裁切多余区域
        new_w = int(h * target_aspect)
        offset_x = (w - new_w) // 2
        print(f"  [Aspect Adjust] Cropping width from {w} to {new_w} (offset: {offset_x}) for exact 16:10...")
        return img_pil.crop((offset_x, 0, offset_x + new_w, h))
    else:
        # 过高 (如 4:3 = 1.333)，从上下两侧居中裁切多余区域
        new_h = int(w / target_aspect)
        offset_y = (h - new_h) // 2
        print(f"  [Aspect Adjust] Cropping height from {h} to {new_h} (offset: {offset_y}) for exact 16:10...")
        return img_pil.crop((0, offset_y, w, offset_y + new_h))

def process_single_image(image_path, target_w=DEFAULT_TARGET_W, target_h=DEFAULT_TARGET_H, model_name="realesr-animevideov3", use_tta=True, style="natural", open_preview=True):
    base_name = os.path.splitext(os.path.basename(image_path))[0]
    out_project_dir = os.path.join(OUTPUT_DIR, f"{base_name}_4k_wallpaper")
    os.makedirs(out_project_dir, exist_ok=True)
    
    print("\n" + "="*65)
    print(f"Processing: {os.path.basename(image_path)}")
    print(f"Target: {target_w} x {target_h} (16:10 4K) | Model: {model_name} | Style: {style}")
    print("="*65)

    # 1. 载入并智能修正画幅
    raw_img = Image.open(image_path).convert("RGBA")
    w_raw, h_raw = raw_img.size
    
    # 消除可能存在的边缘透明噪点
    bg_clean = Image.new("RGB", (w_raw, h_raw), (255, 255, 255))
    bg_clean.paste(raw_img, mask=raw_img.split()[3])
    
    target_aspect = target_w / float(target_h)
    fitted_img = fit_to_aspect_ratio(bg_clean, target_aspect=target_aspect)

    # 2. 超分输入预处理: 若原本就是被低级双线性虚胖放大的图像，先平滑收拢到基准尺寸
    temp_in = os.path.join(TOOLS_DIR, f"temp_{base_name}_in.png")
    temp_out = os.path.join(TOOLS_DIR, f"temp_{base_name}_out.png")

    fw, fh = fitted_img.size
    if fw > 2000:
        base_prep = fitted_img.resize((1920, int(1920 / target_aspect)), Image.Resampling.LANCZOS)
    else:
        base_prep = fitted_img
    base_prep.save(temp_in)

    # 3. 运行 GPU 神经网络超分 (Real-ESRGAN Vulkan)
    print(f"  [GPU Inference] Running Real-ESRGAN Anime 4x (TTA={use_tta})...")
    cmd = [
        REAL_ESRGAN_EXE,
        "-i", temp_in,
        "-o", temp_out,
        "-n", model_name,
        "-s", "4"
    ]
    if use_tta:
        cmd.append("-x")

    subprocess.run(cmd, cwd=TOOLS_DIR, check=True)

    # 4. 高阶抗锯齿降采样至目标 4K
    print(f"  [Downsampling] Lanczos4 anti-aliasing to {target_w} x {target_h}...")
    sr_img = Image.open(temp_out)
    final_4k = sr_img.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # 清理临时文件
    if os.path.exists(temp_in): os.remove(temp_in)
    if os.path.exists(temp_out): os.remove(temp_out)

    # 5. 保存底图到壁纸工程目录
    dst_bg_path = os.path.join(out_project_dir, "bg.png")
    final_4k.save(dst_bg_path, compress_level=3)
    print(f"  [Output] 4K background saved: {dst_bg_path}")

    # 6. 自动组装交互式 Web 动态壁纸工程包
    print(f"  [Packaging] Assembling interactive Web Wallpaper bundle...")
    for f in ["index.html", "wallpaper.js", "project.json", "README.md"]:
        src_template_file = os.path.join(TEMPLATE_DIR, f)
        dst_file = os.path.join(out_project_dir, f)
        if os.path.exists(src_template_file):
            with open(src_template_file, "r", encoding="utf-8") as rf:
                content = rf.read()
            # 替换工程标题
            content = content.replace("木之本樱 & 小可 - 4K 交互式动态壁纸", f"{base_name} - 4K 交互式动态壁纸")
            content = content.replace("木之本樱 - 4K 樱花飞舞 (Cardcaptor Sakura Interactive)", f"{base_name} 4K Wallpaper")
            with open(dst_file, "w", encoding="utf-8") as wf:
                wf.write(content)

    print(f"\n>>> 恭喜！动态壁纸工程已打包完成: {out_project_dir}")
    preview_html = os.path.join(out_project_dir, "index.html")

    if open_preview:
        print(f">>> 正在打开浏览器预览壁纸: {preview_html}")
        webbrowser.open(f"file:///{os.path.abspath(preview_html)}")

    return out_project_dir

def main():
    parser = argparse.ArgumentParser(description="笔记本 16:10 4K 动态壁纸全流程一键生成流水线")
    parser.add_argument("--input", "-i", type=str, default=INPUT_DIR, help="输入图片路径或文件夹 (默认 input 目录)")
    parser.add_argument("--output", "-o", type=str, default=OUTPUT_DIR, help="输出目录")
    parser.add_argument("--width", "-W", type=int, default=DEFAULT_TARGET_W, help="目标宽度 (默认 3840)")
    parser.add_argument("--height", "-H", type=int, default=DEFAULT_TARGET_H, help="目标高度 (默认 2400)")
    parser.add_argument("--model", "-m", type=str, default="realesr-animevideov3", choices=["realesr-animevideov3", "realesrgan-x4plus-anime", "realesrgan-x4plus"], help="超分模型名称")
    parser.add_argument("--no-tta", action="store_true", help="禁用 TTA 模式 (可略微加快速度，但建议保留以获得最佳线条抗锯齿)")
    parser.add_argument("--style", "-s", type=str, default="natural", choices=["natural", "film"], help="画风风格")
    parser.add_argument("--no-browser", action="store_true", help="处理完成后不自动打开浏览器预览")
    args = parser.parse_args()

    # 确定输入图片列表
    images = []
    if os.path.isfile(args.input):
        images.append(args.input)
    elif os.path.isdir(args.input):
        exts = [".jpg", ".jpeg", ".png", ".webp", ".bmp"]
        for root, _, files in os.walk(args.input):
            for f in files:
                if any(f.lower().endswith(ext) for ext in exts):
                    images.append(os.path.join(root, f))
    
    if not images:
        print(f"提示: 未在 {args.input} 找到待处理的图片文件。")
        print("请将待处理的图片放入 input/ 文件夹后重新运行，或指定 -i 参数！")
        return

    print(f"找到 {len(images)} 张图片待处理...")
    for idx, img_path in enumerate(images):
        process_single_image(
            img_path,
            target_w=args.width,
            target_h=args.height,
            model_name=args.model,
            use_tta=not args.no_tta,
            style=args.style,
            open_preview=not args.no_browser and (idx == 0) # 仅预览首张
        )

if __name__ == "__main__":
    main()
