# index.py
import os
import subprocess
import sys
from pathlib import Path

# Добавляем корневую папку в sys.path
root_dir = Path(__file__).parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

# Импортируем конфигурацию
try:
    import config
except ImportError:
    print("❌ Файл config.py не найден!")
    print("Убедитесь, что config.py находится в той же папке, что и index.py")
    input("\nНажмите Enter для выхода...")
    sys.exit(1)

def clear_screen():
    """Очистка экрана"""
    os.system('cls' if os.name == 'nt' else 'clear')

def show_menu():
    """Отображение меню"""
    clear_screen()
    print("=" * 60)
    print("🎨 ГЕНЕРАТОР КОНТЕНТА")
    print("=" * 60)
    print("Выберите тип генерации:")
    print("1. 🖼️  Изображения (FLUX)")
    print("2. 🎵 Звуковые эффекты (Stable Audio)")
    print("3. 🎶 Музыка (MusicGen)")
    print("4. 👾 Пиксельные изображения (Pixel Art)")
    print("5. 🎨 ControlNet (генерация по контуру)")
    print("6. 📝 Транскрипция (MOSS-Transcribe-Diarize)")
    print("0. Выход")
    print("=" * 60)

def get_python_executable(env_name):
    """Возвращает путь к python.exe в указанном виртуальном окружении"""
    base_dir = Path(__file__).parent
    
    candidates = [
        base_dir / env_name / "Scripts" / "python.exe",  # Windows
        base_dir / env_name / "bin" / "python",          # Linux/Mac
    ]
    
    for path in candidates:
        if path.exists():
            return str(path)
    
    return None

def run_script(python_path, script_folder):
    """Запускает generate.py с нужным python"""
    if not python_path:
        print(f"❌ Не найден python для {script_folder}")
        print(f"Проверьте, что окружение существует")
        input("\nНажмите Enter...")
        return False
    
    base_dir = Path(__file__).parent
    script_path = base_dir / script_folder / "generate.py"
    
    if not script_path.exists():
        print(f"❌ Скрипт {script_path} не найден!")
        print(f"Проверьте, что файл generate.py находится в папке {script_folder}")
        input("\nНажмите Enter...")
        return False
    
    print(f"\n🚀 Запуск {script_folder}...")
    print(f"🐍 Python: {python_path}")
    print(f"📄 Скрипт: {script_path}")
    print("-" * 60)
    
    # Передаем переменные окружения
    env = os.environ.copy()
    env['HF_HOME'] = config.HF_HOME
    env['HUGGINGFACE_HUB_CACHE'] = config.HUGGINGFACE_HUB_CACHE
    env['TRANSFORMERS_CACHE'] = config.TRANSFORMERS_CACHE
    
    try:
        subprocess.run(
            [python_path, str(script_path)],
            cwd=str(base_dir),
            env=env,
            check=True
        )
        return True
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Ошибка выполнения: {e}")
    except KeyboardInterrupt:
        print("\n\n⚠️ Прервано пользователем")
    except Exception as e:
        print(f"\n❌ Неожиданная ошибка: {e}")
    
    return False

def main():
    # Устанавливаем окружение
    config.setup_environment()
    
    while True:
        show_menu()
        choice = input("Ваш выбор: ").strip()
        
        if choice == "0":
            print("\n👋 До свидания!")
            break
        elif choice in ["1", "2", "3", "4", "5", "6"]:
            # Маппинг выбора на тип генерации
            type_map = {
                "1": "image",
                "2": "sfx",
                "3": "music",
                "4": "pixel",
                "5": "controlnet",
                "6": "transcribe",
            }
            
            gen_type = type_map[choice]
            env_name = config.ENVIRONMENTS.get(gen_type)
            script_folder = config.SCRIPT_FOLDERS.get(gen_type)
            
            if not env_name or not script_folder:
                print(f"❌ Не найдена конфигурация для {gen_type}")
                input("\nНажмите Enter...")
                continue
            
            python_path = get_python_executable(env_name)
            
            if run_script(python_path, script_folder):
                input("\nНажмите Enter для возврата в меню...")
            
        else:
            print("⚠️ Неверный выбор")
            input("Нажмите Enter...")

if __name__ == "__main__":
    main()